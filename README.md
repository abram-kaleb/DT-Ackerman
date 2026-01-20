Digital Twin Dashboard
A high-performance, real-time industrial monitoring dashboard for marine engine telematics. This application provides a "Digital Twin" interface to monitor, analyze, and control engine parameters remotely.

🚀 Key Features
Real-time Data Stream: Leverages Supabase Postgres Changes for instant data updates without refreshing.
Remote MQTT Control: Integrated MQTT client to send control commands (RPM and Load) back to the engine.

Interactive UI:
Draggable Windows: Customize your workspace by moving gauges and charts.
Dynamic Gauges: Visual indicators for RPM, Load, and Exhaust Temperatures.
Trend Analysis: Full-screen historical data visualization with configurable time ranges (-5m to -30d).
Smart Alarm System: Automated detection for Engine Overspeed, Low Oil Pressure, and High Exhaust Temperatures with acknowledgement (ACK) functionality.

🛠 Tech Stack
Frontend: React.js
Real-time Database: Supabase (PostgreSQL)
Messaging: MQTT (EMQX Broker)
Visuals: Recharts (Trends) & React-Gauge-Component (Instrumentation)
Interactivity: React-Draggable

📖 How to Use
1. Monitoring
Gauges: Observe the circular gauges for live RPM and Load. If a value exceeds safety limits, the window will flash red.
Exhaust Detail: Click the Exhaust Temp gauge to expand and view individual cylinder temperatures (C1-C6).

2. Controlling
Use the Remote Control window on the left.
Adjust the sliders for RPM or Load.
Click "Set" to transmit the command via MQTT.
Emergency Idle: Click the red button to instantly reset the engine to 400 RPM and 0% Load.

3. Data Analysis
The Trend window at the bottom left shows live graphing.
Click the graph to enter Trend Analysis mode.
Select specific parameters (e.g., Fuel Rate) and time ranges to analyze historical performance.
