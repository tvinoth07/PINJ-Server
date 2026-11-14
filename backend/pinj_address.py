"""Prints this PC's network (LAN) IPv4 address, for START_PINJ.bat's "Other PCs: http://<ip>:8080" line.
Uses the address Windows would send from (a UDP connect sends no packet); '(no network)' when offline."""
import socket

s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(("10.255.255.255", 1))
    print(s.getsockname()[0])
except OSError:
    print("(no network)")
finally:
    s.close()
