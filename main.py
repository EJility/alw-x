import requests
from flask import Flask, request

app = Flask(__name__)

# User's Make.com webhook URL (connects to Discord)
FORWARD_TO = "https://hook.us2.make.com/vkh6oaav9bxdydso695byyjjlhalu6of"

@app.route("/alwx", methods=["POST"])
def forward_trade():
    data = request.json
    if not data:
        return "No data received", 400

    # Forward the data to Make.com webhook
    resp = requests.post(FORWARD_TO, json=data)
    return f"Forwarded with status {resp.status_code}", resp.status_code

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
