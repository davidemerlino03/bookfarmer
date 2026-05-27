from threading import Thread
import subprocess
import socket
import time

ADB_PATH = "adb"
SCRCPY_SERVER_PATH = "scrcpy-server"
DEVICE_SERVER_PATH = "/data/local/tmp/scrcpy-server.jar"
DEFAULT_LOCAL_PORT = 27183

class Scrcpy:
    def __init__(self, serial=None, local_port=DEFAULT_LOCAL_PORT, max_size=720, max_fps=30):
        self.serial = serial
        self.local_port = local_port
        self.max_size = max_size
        self.max_fps = max_fps
        self.video_socket = None
        self.control_socket = None

        self.android_thread = None
        self.video_thread = None
        self.control_thread = None
        self.android_process = None

    def adb_cmd(self, *args):
        cmd = [ADB_PATH]
        if self.serial:
            cmd.extend(["-s", self.serial])
        cmd.extend(args)
        return cmd

    def push_server_to_device(self):
        print("Pushing scrcpy-server.jar to device...")
        result = subprocess.run(self.adb_cmd("push", SCRCPY_SERVER_PATH, DEVICE_SERVER_PATH), capture_output=True, text=True)
        if result.returncode != 0:
            print(f"Error pushing server: {result.stderr}")
            return False
        return True

    def setup_adb_forward(self):
        print(f"Setting up ADB forward: tcp:{self.local_port} -> localabstract:scrcpy")
        subprocess.run(self.adb_cmd("forward", "--remove", f"tcp:{self.local_port}"), capture_output=True)
        subprocess.run(self.adb_cmd("forward", f"tcp:{self.local_port}", "localabstract:scrcpy"), check=True)

    def start_server(self):
        print("Starting scrcpy server in background...")
        server_options = [
            "tunnel_forward=true",
            "log_level=VERBOSE",
            f"video_bit_rate={self.video_bit_rate}",
            f"max_size={self.max_size}",
            f"max_fps={self.max_fps}",
            "audio=false",
        ]
        cmd = self.adb_cmd(
            "shell",
            f"CLASSPATH={DEVICE_SERVER_PATH} app_process / com.genymobile.scrcpy.Server 3.1 " + " ".join(server_options)
        )
        self.android_process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        while not self.stop:
            stderr_line = self.android_process.stderr.readline().decode().strip()
            if not stderr_line:
                break
            if stderr_line:
                print(f"Server error: {stderr_line}")
        self.android_process.wait()
        print("Server stopped")

    def receive_video_data(self):
        print("Receiving video data (H.264)...")
        try:
            self.video_socket.recv(1)
        except OSError as e:
            print("Video data reception stopped")
            print(f"Error receiving video data: {e}")
            return
        bytes_count = 0
        last_report = time.time()
        while not self.stop:
            try:
                data = self.video_socket.recv(20480)
            except OSError:
                break
            if not data:
                break
            bytes_count += len(data)
            now = time.time()
            if now - last_report >= 2:
                print(f"Video stream {self.serial}: {bytes_count} bytes in {now - last_report:.1f}s")
                bytes_count = 0
                last_report = now
            self.video_callback(data)
        print("Video data reception stopped")

    def handle_control_conn(self):
        print("Control connection established (idle)...")
        try:
            self.control_socket.recv(1)
        except OSError:
            print("Control connection stopped")
            return
        while not self.stop:
            try:
                data = self.control_socket.recv(1024)
            except OSError:
                break
            if not data:
                break
            print("Control Mesg:", data)
        print("Control connection stopped")

    def scrcpy_start(self, video_callback, video_bit_rate):
        self.video_bit_rate = video_bit_rate
        self.video_callback = video_callback
        self.stop = False

        result = subprocess.run([ADB_PATH, "devices"], capture_output=True, text=True)
        devices = [
            line.split()[0]
            for line in result.stdout.splitlines()[1:]
            if len(line.split()) >= 2 and line.split()[1] == "device"
        ]
        if self.serial and self.serial not in devices:
            print(f"Selected device {self.serial} was not found or is not authorized.")
            print(result.stdout)
            return False
        if not devices:
            print("No device found. Please connect your Android device via USB.")
            print(result.stdout)
            return False
        if not self.serial and len(devices) > 1:
            print("More than one device/emulator is connected. Start with --serial DEVICE_ID.")
            print(result.stdout)
            return False
        print(result.stdout)

        if not self.push_server_to_device():
            print("Failed to push server files to device.")
            return False

        self.setup_adb_forward()
        self.android_thread = Thread(target=self.start_server, daemon=True)
        self.android_thread.start()
        time.sleep(1)

        # video connection
        self.video_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.video_socket.connect(('localhost', self.local_port))
        print("Video connection established")

        # contorl connection
        self.control_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.control_socket.connect(('localhost', self.local_port))
        print("Control connection established")

        self.video_thread = Thread(target=self.receive_video_data, daemon=True)
        self.control_thread = Thread(target=self.handle_control_conn, daemon=True)
        self.video_thread.start()
        self.control_thread.start()
        print("Background tasks started")
        return True

    def scrcpy_stop(self):
        print("Stopping Scrcpy")
        self.stop = True
        for sock in (self.video_socket, self.control_socket):
            if sock:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                sock.close()

        for thread in (self.video_thread, self.control_thread):
            if thread:
                thread.join()
        if self.android_process:
            self.android_process.terminate()
        if self.android_thread:
            self.android_thread.join()
        subprocess.run(self.adb_cmd("forward", "--remove", f"tcp:{self.local_port}"), capture_output=True)
        print("Scrcpy stopped")

    def scrcpy_send_control(self, data):
        if self.control_socket:
            self.control_socket.send(data)
