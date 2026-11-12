"""
Client CoAP minimal (UDP), écrit à la main pour montrer le protocole
(RFC 7252 : message CON, Uri-Path, Content-Format 60 = CBOR, retransmissions).
"""
import os
import random
import socket
import struct
import time


class CoapClient:
    CON, NON, ACK, RST = 0, 1, 2, 3
    POST = 0x02
    OPT_URI_PATH, OPT_CONTENT_FORMAT = 11, 12
    CF_CBOR = 60

    def __init__(self, host, port, timeout=1.5, retries=2):
        self.addr = (host, port)
        self.timeout = timeout
        self.retries = retries
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.settimeout(timeout)
        self.mid = random.randint(0, 0xFFFF)

    @staticmethod
    def _nibble(x):
        if x < 13:
            return x, b""
        if x < 269:
            return 13, bytes([x - 13])
        return 14, struct.pack("!H", x - 269)

    def _encode_option(self, delta, value):
        d, d_ext = self._nibble(delta)
        l, l_ext = self._nibble(len(value))
        return bytes([(d << 4) | l]) + d_ext + l_ext + value

    def build(self, path, payload, token):
        self.mid = (self.mid + 1) & 0xFFFF
        header = bytes([(1 << 6) | (self.CON << 4) | len(token), self.POST])
        header += struct.pack("!H", self.mid) + token
        options = [(self.OPT_URI_PATH, seg.encode()) for seg in path.strip("/").split("/")]
        options.append((self.OPT_CONTENT_FORMAT, bytes([self.CF_CBOR])))
        encoded, last = b"", 0
        for number, value in options:
            encoded += self._encode_option(number - last, value)
            last = number
        return header + encoded + b"\xff" + payload

    @staticmethod
    def parse(data):
        if len(data) < 4:
            return None
        tkl = data[0] & 0x0F
        code = data[1]
        token = data[4:4 + tkl]
        i = 4 + tkl
        while i < len(data):
            b = data[i]
            if b == 0xFF:
                i += 1
                break
            delta, length = b >> 4, b & 0x0F
            i += 1
            for field in ("delta", "length"):
                val = delta if field == "delta" else length
                if val == 13:
                    val = data[i] + 13
                    i += 1
                elif val == 14:
                    val = struct.unpack("!H", data[i:i + 2])[0] + 269
                    i += 2
                if field == "delta":
                    delta = val
                else:
                    length = val
            i += length
        else:
            i = len(data)
        return {"code": f"{code >> 5}.{code & 0x1F:02d}", "token": token, "payload": data[i:]}

    def post(self, path, payload):
        token = os.urandom(4)
        msg = self.build(path, payload, token)
        for _ in range(self.retries + 1):
            self.sock.sendto(msg, self.addr)
            deadline = time.time() + self.timeout
            try:
                while time.time() < deadline:
                    data, _ = self.sock.recvfrom(4096)
                    resp = self.parse(data)
                    if resp and resp["token"] == token:
                        return resp
            except (socket.timeout, ConnectionResetError):
                continue
        return None
