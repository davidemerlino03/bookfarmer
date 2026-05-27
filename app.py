from flask import Flask, jsonify, render_template, request
from flask_socketio import SocketIO
from scrcpy import Scrcpy
import argparse
from datetime import datetime
import json
import os
import queue
import subprocess
from threading import RLock
import requests
import random
import time

ADB_PATH = "adb"
DEFAULT_BASE_LOCAL_PORT = 27183
DEVICE_METADATA_PATH = os.path.join(os.path.dirname(__file__), "device_metadata.json")
CAPTURES_DIR = os.path.join(os.path.dirname(__file__), "captures")
DEVTOOLS_BASE_PORT = 9300
BOOKMIND_BASE_URL = "https://bookmind.it"

sessions = {}
sessions_lock = RLock()
bookmind_session = None
stopping_sessions = False
active_client_sid = None
video_bit_rate = "512000"
max_size = 720
max_fps = 30
base_local_port = DEFAULT_BASE_LOCAL_PORT
selected_serials = None

bookmakers = None

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, async_mode='threading', cors_allowed_origins='*')


def load_device_metadata():
    if not os.path.exists(DEVICE_METADATA_PATH):
        return {}

    try:
        with open(DEVICE_METADATA_PATH, "r", encoding="utf-8") as metadata_file:
            metadata = json.load(metadata_file)
    except (OSError, ValueError):
        return {}

    if not isinstance(metadata, dict):
        return {}

    return metadata


def get_bookmaker_url(bookmaker):
    global bookmakers

    if bookmakers is None:
        get_bookmakers()

    selected_bookmaker = None
    for b in bookmakers:
        print(f"Checking bookmaker: {b.get('name')} against {bookmaker}")
        if b.get("name") == bookmaker:
            selected_bookmaker = b
            break

    return selected_bookmaker


def capture_device_html(serial):
    import websocket

    def receive_cdp_response(ws, command_id):
        while True:
            response = json.loads(ws.recv())
            if response.get("id") == command_id:
                return response

    _, authorized_serials = get_authorized_serials()
    if serial not in authorized_serials:
        raise ValueError(f"Device non autorizzato o non collegato: {serial}")

    port = DEVTOOLS_BASE_PORT + authorized_serials.index(serial)
    subprocess.run(
        [
            ADB_PATH,
            "-s",
            serial,
            "forward",
            f"tcp:{port}",
            "localabstract:chrome_devtools_remote",
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    tabs_response = requests.get(f"http://127.0.0.1:{port}/json", timeout=3)
    tabs_response.raise_for_status()
    tabs = tabs_response.json()

    tab = next(
        (
            item for item in tabs
            if item.get("webSocketDebuggerUrl") and str(item.get("url", "")).startswith(("http://", "https://"))
        ),
        None,
    )
    if tab is None:
        raise RuntimeError("Nessuna tab Chrome HTTP/HTTPS trovata sul device")

    ws = websocket.create_connection(
        tab["webSocketDebuggerUrl"],
        timeout=20,
        suppress_origin=True,
    )
    try:
        ws.settimeout(20)
        ws.send(json.dumps({
            "id": 1,
            "method": "Page.bringToFront",
        }))
        ws.send(json.dumps({
            "id": 2,
            "method": "DOM.getDocument",
            "params": {
                "depth": 0,
                "pierce": True,
            },
        }))
        document_response = receive_cdp_response(ws, 2)
        root_node_id = document_response.get("result", {}).get("root", {}).get("nodeId")
        if root_node_id is None:
            raise RuntimeError(f"Chrome non ha restituito il documento DOM: {document_response}")

        ws.send(json.dumps({
            "id": 3,
            "method": "DOM.getOuterHTML",
            "params": {
                "nodeId": root_node_id,
            },
        }))
        message = receive_cdp_response(ws, 3)
    finally:
        ws.close()

    html = message.get("result", {}).get("outerHTML")
    if not isinstance(html, str):
        raise RuntimeError(f"Chrome non ha restituito HTML: {message}")

    os.makedirs(CAPTURES_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_serial = "".join(char if char.isalnum() or char in ("-", "_") else "_" for char in serial)
    output_path = os.path.join(CAPTURES_DIR, f"{safe_serial}-{timestamp}.html")
    with open(output_path, "w", encoding="utf-8") as html_file:
        html_file.write(html)

    return {
        "path": output_path,
        "title": tab.get("title", ""),
        "url": tab.get("url", ""),
        "bytes": len(html.encode("utf-8")),
    }



@app.route('/')
def index():
    return render_template('index.html')


def external_login():
    global bookmind_session

    bookmind_session = requests.Session()
    try:
        response = bookmind_session.post(
            f"{BOOKMIND_BASE_URL}/login",
            json={
                "username": "davide",
                "password": "bookmind"
            },
            allow_redirects=False,
            timeout=10,
        )
    except requests.RequestException as exc:
        bookmind_session = None
        return {"ok": False, "error": f"Bookmind non raggiungibile: {exc}"}, 503

    if response.status_code not in [200, 302]:
        bookmind_session = None
        return {"ok": False, "error": "Login fallito"}, 401

    token = bookmind_session.cookies.get("token")

    print(f"Session cookies: {bookmind_session.cookies.get_dict()}")

    return {
        "ok": True,
        "token": token
    }


def ensure_bookmind_session():
    if bookmind_session is not None:
        return None

    result = external_login()
    if isinstance(result, tuple):
        payload, status = result
        return jsonify(payload), status

    return None

@app.route('/accounts')
def get_accounts():
    global bookmind_session

    session_error = ensure_bookmind_session()
    if session_error:
        return session_error

    try:
        response = bookmind_session.get(
            f"{BOOKMIND_BASE_URL}/reserved/api/v1/accounts",
            allow_redirects=False,
            timeout=10,
        )
    except requests.RequestException as exc:
        bookmind_session = None
        return jsonify({"ok": False, "error": f"Bookmind non raggiungibile: {exc}"}), 503

    print(f"Accounts response: {response.status_code} {response.text[:300]}")

    try:
        payload = response.json()
    except ValueError:
        return jsonify({
            "ok": False,
            "status": response.status_code,
            "error": "La risposta di Bookmind non è JSON",
            "body": response.text[:1000],
        }), 502

    return jsonify(payload)

@app.route('/bookmakers')
def get_bookmakers():
    global bookmind_session

    session_error = ensure_bookmind_session()
    if session_error:
        return session_error

    try:
        response = bookmind_session.get(
            f"{BOOKMIND_BASE_URL}/reserved/api/v1/bookmakers",
            allow_redirects=False,
            timeout=10,
        )
    except requests.RequestException as exc:
        bookmind_session = None
        return jsonify({"ok": False, "error": f"Bookmind non raggiungibile: {exc}"}), 503

    print(f"Bookmakers response: {response.status_code} {response.text[:300]}")

    try:
        payload = response.json()
    except ValueError:
        return jsonify({
            "ok": False,
            "status": response.status_code,
            "error": "La risposta di Bookmind non è JSON",
            "body": response.text[:1000],
        }), 502

    global bookmakers
    bookmakers = payload

    return jsonify(payload)

@app.route('/friends')
def get_friends():
    global bookmind_session

    session_error = ensure_bookmind_session()
    if session_error:
        return session_error

    try:
        response = bookmind_session.get(
            f"{BOOKMIND_BASE_URL}/reserved/api/v1/friends",
            allow_redirects=False,
            timeout=10,
        )
    except requests.RequestException as exc:
        bookmind_session = None
        return jsonify({"ok": False, "error": f"Bookmind non raggiungibile: {exc}"}), 503

    print(f"Friends response: {response.status_code} {response.text[:300]}")

    try:
        payload = response.json()
    except ValueError:
        return jsonify({
            "ok": False,
            "status": response.status_code,
            "error": "La risposta di Bookmind non è JSON",
            "body": response.text[:1000],
        }), 502

    return jsonify(payload)

@app.route('/setAllActiveBookmakerPages', methods=['POST'])
def set_bookmaker_accounts_page():
    payload = request.get_json(silent=True) or {}
    bookmaker = payload.get("bookmaker")

    print(f"Received request to set bookmaker pages: {bookmakers}")

    if not bookmaker:
        return jsonify({
            "ok": False,
            "error": "Bookmaker mancante",
        }), 400

    selected_bookmaker = get_bookmaker_url(bookmaker)
    if selected_bookmaker is None:
        return jsonify({
            "ok": False,
            "error": "Bookmaker non trovato",
            "bookmaker": bookmaker,
        }), 404
    
    bookmaker_url = selected_bookmaker.get("home_url") or selected_bookmaker.get("url") or selected_bookmaker.get("link")
    if not bookmaker_url:
        return jsonify({
            "ok": False,
            "error": "URL del bookmaker non trovato",
            "bookmaker": bookmaker,
        }), 404

    if not bookmaker_url.startswith(("http://", "https://")):
        bookmaker_url = f"https://{bookmaker_url}"

    _, authorized_serials = get_authorized_serials()
    for serial in authorized_serials:
        subprocess.run([
            "adb",
            "-s",
            serial,
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            bookmaker_url,
            "com.android.chrome",
        ])

        time.sleep(random.uniform(0.2, 1))

    return jsonify({
        "ok": True,
        "bookmaker": bookmaker,
        "url": bookmaker_url,
        "devices": authorized_serials,
    })

@app.route('/api/sendAccountMovement', methods=['POST'])
def send_account_movement():
    global bookmind_session

    session_error = ensure_bookmind_session()
    if session_error:
        return session_error

    payload = request.get_json(silent=True) or {}
    # Process the account movement data here

    try:
        result = bookmind_session.post(
            f"{BOOKMIND_BASE_URL}/reserved/api/v1/movements",
            json=payload,
            allow_redirects=False,
            timeout=10,
        )
    except requests.RequestException as exc:
        bookmind_session = None
        return jsonify({"ok": False, "error": f"Bookmind non raggiungibile: {exc}"}), 503

    print(f"Movement response: {result.status_code} {result.text[:300]}")

    try:
        response_payload = result.json()
    except ValueError:
        response_payload = {
            "ok": result.ok,
            "status": result.status_code,
            "message": "Bookmind non ha restituito JSON",
            "body": result.text[:1000],
        }

    return jsonify(response_payload), result.status_code

def list_adb_devices():
    result = subprocess.run([ADB_PATH, "devices"], capture_output=True, text=True)
    devices = []
    for line in result.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2:
            devices.append({"serial": parts[0], "state": parts[1]})
    return devices

def video_send_task(serial):
    with sessions_lock:
        session = sessions.get(serial)
    if not session:
        return

    while True:
        with sessions_lock:
            should_continue = sessions.get(serial) is session and session["client_sid"] is not None
            client_sid = session["client_sid"]
        if not should_continue:
            break

        try:
            message = session["queue"].get(timeout=0.01)
            socketio.emit(f'video_data:{serial}', message, to=client_sid)
        except queue.Empty:
            pass
        except Exception as e:
            print(f"Error sending data for {serial}: {e}")
        finally:
            socketio.sleep(0.001)
    print(f"video_send_task stopped for {serial}")

def start_device_session(serial, local_port, client_sid):
    video_queue = queue.Queue()

    def send_video_data(data):
        video_queue.put(data)

    scpy_ctx = Scrcpy(serial, local_port=local_port, max_size=max_size, max_fps=max_fps)
    try:
        started = scpy_ctx.scrcpy_start(send_video_data, video_bit_rate)
    except Exception as e:
        print(f"Failed to start {serial}: {e}")
        started = False

    if not started:
        scpy_ctx.scrcpy_stop()
        return False

    with sessions_lock:
        sessions[serial] = {
            "client_sid": client_sid,
            "local_port": local_port,
            "queue": video_queue,
            "scrcpy": scpy_ctx,
        }
    socketio.start_background_task(video_send_task, serial)
    return True


def stop_all_sessions():
    global stopping_sessions
    with sessions_lock:
        if stopping_sessions:
            return
        stopping_sessions = True
        sessions_to_stop = list(sessions.items())
        sessions.clear()
        for _, session in sessions_to_stop:
            session["client_sid"] = None

    for serial, session in sessions_to_stop:
        print(f"Stopping session for {serial}")
        session["scrcpy"].scrcpy_stop()

    with sessions_lock:
        stopping_sessions = False


def stop_device_session(serial):
    with sessions_lock:
        session = sessions.pop(serial, None)
        if session:
            session["client_sid"] = None

    if not session:
        return None

    print(f"Stopping session for {serial}")
    session["scrcpy"].scrcpy_stop()
    return session


def wait_until_sessions_stopped():
    while True:
        with sessions_lock:
            if not stopping_sessions:
                return
        socketio.sleep(0.05)


def get_authorized_serials():
    devices = list_adb_devices()
    authorized_serials = [device["serial"] for device in devices if device["state"] == "device"]
    if selected_serials:
        authorized_serials = [serial for serial in authorized_serials if serial in selected_serials]
    return devices, authorized_serials


def start_authorized_devices(client_sid):
    wait_until_sessions_stopped()
    devices, authorized_serials = get_authorized_serials()
    started_count = 0
    for index, serial in enumerate(authorized_serials):
        local_port = base_local_port + index
        socketio.emit('device_status', {"serial": serial, "status": "starting"}, to=client_sid)
        if start_device_session(serial, local_port, client_sid):
            started_count += 1
            socketio.emit(
                'device_status',
                {"serial": serial, "status": "connected", "local_port": local_port},
                to=client_sid,
            )
        else:
            socketio.emit('device_status', {"serial": serial, "status": "failed"}, to=client_sid)

    if started_count == 0:
        return False

    print(f'connected dashboard with {started_count} device session(s)')
    return True


@socketio.on('connect')
def handle_connect():
    global active_client_sid
    print('Dashboard connected')
    wait_until_sessions_stopped()

    if active_client_sid is not None:
        print(f'reject connection, dashboard {active_client_sid} is already connected')
        return False

    active_client_sid = request.sid
    devices, authorized_serials = get_authorized_serials()
    metadata = load_device_metadata()

    socketio.emit(
        'device_list',
        {
            "devices": devices,
            "selected": authorized_serials,
            "metadata": {
                serial: {
                    "id": str((metadata.get(serial) or {}).get("id", "")),
                    "name": str((metadata.get(serial) or {}).get("name", "")),
                }
                for serial in authorized_serials
            },
            "config": {
                "max_size": max_size,
                "max_fps": max_fps,
                "video_bit_rate": video_bit_rate,
            },
        },
        to=request.sid,
    )

    if not authorized_serials:
        print("No authorized devices found.")
        active_client_sid = None
        return False

    print(f'dashboard ready for {len(authorized_serials)} authorized device(s)')


@socketio.on('start_devices')
def handle_start_devices():
    if request.sid != active_client_sid:
        return False

    wait_until_sessions_stopped()
    with sessions_lock:
        has_sessions = bool(sessions)
    if has_sessions:
        print("Device sessions are already running")
        return

    return start_authorized_devices(request.sid)


@socketio.on('stream_config')
def handle_stream_config(config):
    global max_size
    if request.sid != active_client_sid:
        return False

    try:
        new_max_size = int(config.get("max_size", max_size))
    except (TypeError, ValueError):
        return False

    new_max_size = max(240, min(2160, new_max_size))
    if new_max_size == max_size:
        return

    max_size = new_max_size
    print(f"Restarting streams with max_size={max_size}")
    socketio.emit('stream_config', {"max_size": max_size}, to=request.sid)

    stop_all_sessions()
    return start_authorized_devices(request.sid)


@socketio.on('reset_device')
def handle_reset_device(serial):
    if request.sid != active_client_sid:
        return False

    devices, authorized_serials = get_authorized_serials()
    if serial not in authorized_serials:
        socketio.emit('device_status', {"serial": serial, "status": "failed"}, to=request.sid)
        return False

    with sessions_lock:
        session = sessions.get(serial)

    if session:
        local_port = session["local_port"]
    else:
        local_port = base_local_port + authorized_serials.index(serial)

    socketio.emit('device_status', {"serial": serial, "status": "starting"}, to=request.sid)
    stop_device_session(serial)

    if start_device_session(serial, local_port, request.sid):
        socketio.emit(
            'device_status',
            {"serial": serial, "status": "connected", "local_port": local_port},
            to=request.sid,
        )
        return True

    socketio.emit('device_status', {"serial": serial, "status": "failed"}, to=request.sid)
    return False


def capture_html_task(serial, client_sid):
    socketio.emit('html_capture_status', {"serial": serial, "status": "running"}, to=client_sid)
    try:
        result = capture_device_html(serial)
    except Exception as exc:
        socketio.emit(
            'html_capture_status',
            {"serial": serial, "status": "failed", "error": str(exc)},
            to=client_sid,
        )
        return

    socketio.emit(
        'html_capture_status',
        {"serial": serial, "status": "completed", **result},
        to=client_sid,
    )


@socketio.on('capture_html')
def handle_capture_html(serial):
    if request.sid != active_client_sid:
        return False

    socketio.start_background_task(capture_html_task, serial, request.sid)
    return True



@socketio.on('disconnect')
def handle_disconnect():
    global active_client_sid
    print('Dashboard disconnected')
    active_client_sid = None
    stop_all_sessions()


@socketio.on('control_data')
def handle_control_data(serial, data):
    session = sessions.get(serial)
    if session and data is not None:
        session["scrcpy"].scrcpy_send_control(data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Web server for scrcpy')
    parser.add_argument('--video_bit_rate', default="512000", help='scrcpy video bit rate')
    parser.add_argument('--max_size', type=int, default=720, help='maximum mirrored dimension')
    parser.add_argument('--max_fps', type=int, default=30, help='maximum video frame rate')
    parser.add_argument('--base_port', type=int, default=DEFAULT_BASE_LOCAL_PORT, help='first local ADB forward port')
    parser.add_argument(
        '--serial',
        action='append',
        help='ADB device serial to include. Repeat this option to include multiple devices.',
    )
    args = parser.parse_args()
    video_bit_rate = args.video_bit_rate
    max_size = args.max_size
    max_fps = args.max_fps
    base_local_port = args.base_port
    selected_serials = args.serial
    socketio.run(app, host='0.0.0.0', port=5001, allow_unsafe_werkzeug=True)
