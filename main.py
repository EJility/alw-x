from flask import Flask, jsonify
import requests

app = Flask(__name__)

DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1356083288099520643/WxzFUsLw0F2nHHD4_eGdF8HmPUO00l4MXwGlsSYTg5bBrdBVLYHvuSVsYYo-3Ze6H8BK"

@app.route("/")
def home():
    return "ALW-X Bridge is online!"

@app.route("/test")
def test():
    return "Test route working!"

@app.route("/mock-alert")
def mock_alert():
    data = {
        "content": "**ALW-X Test Alert**: The Bridge is fully operational and ready to send trades!"
    }
    response = requests.post(DISCORD_WEBHOOK_URL, json=data)
    if response.status_code == 204:
        return jsonify({"status": "success", "message": "Alert sent to Discord!"})
    else:
        return jsonify({"status": "error", "message": f"Failed to send. Code: {response.status_code}"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
