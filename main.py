from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# CORS enable (frontend connect ke liye MUST)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------- MODELS ----------------
class TokenRequest(BaseModel):
    token: str

class BindRequest(BaseModel):
    token: str
    email: str

# ---------------- HOME ----------------
@app.get("/")
def home():
    return {"msg": "Backend is running 🚀"}

# ---------------- CHECK ----------------
@app.post("/check")
def check_bind(data: TokenRequest):
    token = data.token.strip()

    if not token:
        return {"status": "error", "msg": "Token missing ❌"}

    if len(token) < 10:
        return {"status": "invalid", "msg": "Token too short ❌"}

    return {
        "status": "success",
        "msg": "Token valid ✅",
        "bind": "Email is active"
    }

# ---------------- BIND CHANGE ----------------
@app.post("/bind-change")
def bind_change(data: BindRequest):
    token = data.token.strip()
    email = data.email.strip()

    if not token or not email:
        return {"status": "error", "msg": "Missing data ❌"}

    return {
        "status": "success",
        "msg": "Bind changed successfully ✅",
        "old_token": token,
        "new_email": email
    }

# ---------------- UNBIND ----------------
@app.post("/unbind")
def unbind(data: TokenRequest):
    token = data.token.strip()

    if not token:
        return {"status": "error", "msg": "Token missing ❌"}

    return {
        "status": "success",
        "msg": "Email unbound successfully ✅",
        "token": token
    }
