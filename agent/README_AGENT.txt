PINJ MODEM AGENT
================

What it does
  Connects the radio modem plugged into THIS PC to your own PINJ bench on the PINJ server.
  Your modem shows up in PINJ as  AGENT:COMx  (SVK SIM -> SERIAL RADIO MODEM -> refresh the port list).
  Test logs are also saved on this PC:  Documents\PINJ\logs   (change "log_dir" in agent_config.json).

Use it
  1. Plug in the modem (USB-serial cable).
  2. Double-click PINJ_AGENT.bat and keep the window open while you test.
  3. In PINJ (browser): SVK SIM -> SERIAL RADIO MODEM -> pick "AGENT:COMx ... on your PC" -> save.
  Close the window when you are done: the modem is released (PTT off, port closed).

Good to know
  - Needs Python 3.9 or newer (python.org). Nothing else to install - the two libraries are in lib\.
  - The agent connects OUT to the PINJ server: nothing has to be opened in this PC's firewall.
  - agent_config.json holds YOUR personal key. Do not share it. Downloading the agent again
    makes a new key, and the old copy stops working.
  - If the network or the server goes away, the agent drops PTT and closes the port at once,
    then reconnects by itself.
