"""Full end-to-end journey: register -> request ride -> accept -> arrive ->
start -> complete -> card payment -> notifications + push-token registration.

This is the "smoke test" for launch-readiness: one rider and one driver run the
entire product lifecycle against a live backend, asserting every step.

Run: pytest tests/test_e2e_full_flow.py -v   (backend server must be running)
"""
import uuid
import requests

from conftest import API, make_verified_online_driver, register

LAGOS = {"pickup_lat": 6.5100, "pickup_lng": 3.3700, "dropoff_lat": 6.4534, "dropoff_lng": 3.3942}


def test_full_ride_lifecycle_and_payment(session):
    # 1. Fresh rider registers (real sign-up path, no fixtures reused).
    rid = uuid.uuid4().hex[:8]
    rider = register(session, f"E2E_RIDER_{rid}")
    rider_token = rider["token"]

    # 2. Driver registers, gets verified, and comes online near Yaba, Lagos.
    driver = make_verified_online_driver(session, f"E2E_DRV_{rid}", vehicle_type="car", plate="LAG-E2E", lat=6.51, lng=3.37)
    driver_token = driver["token"]

    # 3. Push-token registration (new device endpoint the app calls on login).
    r = session.post(f"{API}/me/push-token", json={"push_token": f"ExponentPushToken[{uuid.uuid4().hex}]"},
                     headers={"Authorization": f"Bearer {rider_token}"})
    assert r.status_code == 200, r.text

    # 4. Rider estimates the fare first.
    r = session.post(f"{API}/rides/estimate", json={"vehicle_type": "car", **LAGOS})
    assert r.status_code == 200 and r.json()["allowed"] is True, r.text
    estimate = r.json()["fare"]

    # 5. Rider requests the ride.
    r = session.post(
        f"{API}/rides",
        json={"vehicle_type": "car", "payment_method": "card", "pickup_address": "Yaba", "dropoff_address": "CMS", **LAGOS},
        headers={"Authorization": f"Bearer {rider_token}"},
    )
    assert r.status_code == 200, r.text
    ride = r.json()
    ride_id = ride["ride_id"]
    assert ride["status"] == "requested" and ride["fare_estimate"] > 0

    # 6. Driver accepts.
    r = session.post(f"{API}/rides/{ride_id}/accept", headers={"Authorization": f"Bearer {driver_token}"})
    assert r.status_code == 200 and r.json()["status"] == "accepted", r.text

    # 7. Driver arrives and starts the trip.
    r = session.post(f"{API}/rides/{ride_id}/arrive", headers={"Authorization": f"Bearer {driver_token}"})
    assert r.status_code == 200 and r.json()["status"] == "arriving", r.text
    r = session.post(f"{API}/rides/{ride_id}/start", headers={"Authorization": f"Bearer {driver_token}"})
    assert r.status_code == 200 and r.json()["status"] == "in_progress", r.text

    # 8. Driver completes the trip; a fare is locked in.
    r = session.post(f"{API}/rides/{ride_id}/complete", headers={"Authorization": f"Bearer {driver_token}"})
    assert r.status_code == 200, r.text
    done = r.json()
    assert done["status"] == "completed" and done["fare"] > 0
    assert abs(done["fare"] - estimate) <= max(estimate * 0.3, 100), "fare drifted too far from estimate"

    # 9. Rider pays with card (dev mode marks it success so the flow is testable).
    r = session.post(f"{API}/payments/card", json={"ride_id": ride_id, "amount": done["fare"]},
                     headers={"Authorization": f"Bearer {rider_token}"})
    assert r.status_code == 200, r.text
    payment_id = r.json()["payment_id"]
    assert "paystack.com/pay/" in r.json()["authorization_url"]
    r = session.post(f"{API}/payments/card/verify", params={"payment_id": payment_id},
                     headers={"Authorization": f"Bearer {rider_token}"})
    assert r.status_code == 200 and r.json()["status"] == "success", r.text

    # 10. Payment shows up in the rider's history.
    r = session.get(f"{API}/payments", params={"role": "customer"}, headers={"Authorization": f"Bearer {rider_token}"})
    assert r.status_code == 200, r.text
    assert any(p["ride_id"] == ride_id and p["status"] == "success" for p in r.json())

    # 11. Notifications landed for both parties (ride + trip completed).
    r = session.get(f"{API}/notifications", headers={"Authorization": f"Bearer {rider_token}"})
    assert r.status_code == 200, r.text
    titles = [n["title"] for n in r.json()]
    assert "Driver accepted" in titles and "Trip completed" in titles, titles

    # 12. Rider rates the trip (closes the loop on feedback).
    r = session.post(f"{API}/trips/{done['trip_id']}/rate", json={"rating": 5, "comment": "Smooth ride"},
                     headers={"Authorization": f"Bearer {rider_token}"})
    assert r.status_code == 200, r.text
