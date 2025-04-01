from flask import Flask, jsonify, request
import requests

app = Flask(__name__)

DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1356083288099520643/WxzFUsLw0F2nHHD4_eGdF8HmPUO00l4MXwGlsSYTg5bBrdBVLYHvuSVsYYo-3Ze6H8BK"

@app.route('/')
def home():
    return 'ALW-X Sentinel is live.'

@app.route('/test')
def test():
    return 'Sentinel Online'

@app.route('/alert', methods=['POST'])
def send_alert():
    data = request.get_json()
    if not data or 'message' not in data:
        return jsonify({'error': 'Missing message field'}), 400

    message = data['message']
    payload = {
        "content": message
    }

    response = requests.post(DISCORD_WEBHOOK_URL, json=payload)

    if response.status_code == 204:
        return jsonify({'status': 'Alert sent successfully'}), 200
    else:
        return jsonify({'status': 'Failed to send alert', 'code': response.status_code}), 500

if __name__ == '__main__':
    app.run(debug=True)
