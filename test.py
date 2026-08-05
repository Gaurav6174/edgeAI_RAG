import requests

API_URL = "http://172.17.0.1:11434/api/generate"

prompt = "Explain how backpropagation works in one paragraph."

payload = {
    "model": "llama3.2:1b",          # Only approved model for Jetson deployment
    "prompt": prompt,
    "stream": False,
    "options": {
        "num_ctx": 1024,           # Keep context small — saves ~500 MB RAM
        "num_gpu": 1,              # 1 GPU device on Jetson Orin
        "use_mmap": True           # Memory-mapped loading for Jetson
    }
}

try:
    response = requests.post(API_URL, json=payload)
    if response.status_code == 200:
        print(response.json()['response'])
    else:
        print(f"Error {response.status_code}: {response.text}")
except requests.exceptions.RequestException as e:
    print(f"Connection Error: {e}")