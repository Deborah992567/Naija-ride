# Naija Ride - Public Transport Tracker

Naija Ride is a crowdsourced real-time public transport tracking system designed for Nigerian cities. It allows users to report vehicle locations, crowd levels, and delays, providing real-time ETA calculations for others on the same route.

## 🚀 Features

- **Crowdsourced Reporting**: Users can report sightings, onboard status, delays, and fare updates for various vehicle types (Danfo, BRT, Keke, Campus Shuttles).
- **Smart ETA**: Real-time arrival predictions based on the latest crowdsourced reports and historical vehicle speeds.
- **User Karma System**: Rewards active contributors with karma points for every verified report submitted.
- **Multi-City Support**: Pre-seeded with popular routes in Lagos, Abuja, Port Harcourt, and university campuses.
- **Hybrid Authentication**: Supports standard Email/Password login (JWT) and Google OAuth via Emergent session integration.

## 🛠 Tech Stack

### Backend
- **Framework**: FastAPI
- **Database**: MariaDB (via SQLAlchemy + `asyncmy` driver)
- **Authentication**: JWT & Google OAuth
- **Async Support**: Fully asynchronous database operations and API handlers.

### Frontend
- **Framework**: Expo (React Native)
- **Routing**: Expo Router
- **Storage**: Combined `AsyncStorage` and `SecureStore` for sensitive data.

## 📦 Installation & Setup

### Prerequisites
- Python 3.12+
- Node.js & npm
- MariaDB instance

### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   pip install fastapi uvicorn sqlalchemy asyncmy pydantic[email] bcrypt pyjwt httpx python-dotenv
   ```
3. Configure environment variables in `.env`:
   ```dotenv
   DB_URL="mysql+asyncmy://root:root1234@localhost/test_db"
   JWT_SECRET="your-secret-key"
   ```
4. Run the server:
   ```bash
   uvicorn server:app --reload
   ```

### Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure the backend URL in `.env`:
   ```dotenv
   EXPO_PUBLIC_BACKEND_URL=http://<your-local-ip>:8000
   ```
4. Start the development server:
   ```bash
   npx expo start
   ```

## 🧪 Testing

To run the end-to-end API tests, ensure the backend is running and execute:
```bash
pytest backend/tests/test_transport_api.py -v
```

## 📄 API Documentation

Once the backend is running, you can access the interactive Swagger UI at:
`http://localhost:8000/docs`
