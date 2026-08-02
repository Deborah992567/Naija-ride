"""Locust load-test scenarios for Naija Ride.

Run against a running backend:

    pip install locust
    locust -f load_testing/locustfile.py --host http://localhost:8001
"""
import uuid

from locust import HttpUser, between, task

API = "/api"


class RiderFlow(HttpUser):
    """A rider who registers, estimates a ride, and requests one."""

    wait_time = between(1, 3)

    def on_start(self):
        self.token = None
        email = f"load_{uuid.uuid4().hex[:8]}@example.com"
        with self.client.post(
            f"{API}/auth/register",
            json={"email": email, "password": "pass1234", "name": "LoadTester"},
            catch_response=True,
        ) as resp:
            if resp.status_code == 200:
                self.token = resp.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}

    @task(3)
    def estimate_ride(self):
        self.client.post(
            f"{API}/rides/estimate",
            json={
                "vehicle_type": "car",
                "pickup_lat": 6.5080,
                "pickup_lng": 3.3720,
                "dropoff_lat": 6.5244,
                "dropoff_lng": 3.3792,
            },
        )

    @task(1)
    def list_zones(self):
        self.client.get(f"{API}/zones")

    @task(1)
    def wallet_balance(self):
        if self.token:
            self.client.get(f"{API}/wallet", headers=self.headers)

    @task(1)
    def place_search(self):
        self.client.get(f"{API}/places/search", params={"q": "ikeja", "limit": 5})


class DriverFlow(HttpUser):
    """A driver who registers and toggles online status."""

    wait_time = between(2, 5)

    def on_start(self):
        email = f"load_driver_{uuid.uuid4().hex[:8]}@example.com"
        with self.client.post(
            f"{API}/auth/register",
            json={"email": email, "password": "pass1234", "name": "LoadDriver"},
            catch_response=True,
        ) as resp:
            if resp.status_code == 200:
                self.token = resp.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}

    @task(2)
    def toggle_status(self):
        if self.token:
            self.client.post(
                f"{API}/drivers/status",
                json={"is_online": True, "lat": 6.5080, "lng": 3.3720},
                headers=self.headers,
            )
