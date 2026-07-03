from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

@app.get("/")
def home():
    return {"msg": "Backend is running 🚀"}

class CheckRequest(BaseModel):
    token: str

@app.post("/check")
def check_bind(data: CheckRequest):

    token = data.token.strip() if data.token else ""

    if not token:
        return {"status": "error", "msg": "Token missing ❌"}

    if len(token) < 10:
        return {"status": "invalid", "msg": "Token too short ❌"}

    return {
        "status": "success",
        "msg": "Token valid ✅",
        "bind": "Email is active",
        "token": token
    }
