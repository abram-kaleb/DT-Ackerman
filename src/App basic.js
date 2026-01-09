import React, { useState, useEffect, useCallback, useRef } from 'react';
import { InfluxDB } from '@influxdata/influxdb-client-browser';
import GaugeComponent from 'react-gauge-component';
import Draggable from 'react-draggable';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import mqtt from 'mqtt';

const token = process.env.REACT_APP_INFLUX_TOKEN;
const org = process.env.REACT_APP_INFLUX_ORG;
const bucket = process.env.REACT_APP_INFLUX_BUCKET;
const url = process.env.REACT_APP_INFLUX_URL;

const TextVal = ({ label, val, unit, large, mini, style }) => (
  <div style={{ color: '#00d4ff', ...style }}>
    {label && (
      <div className="mini-label" style={{ fontSize: mini ? '0.5vw' : '0.6vw', color: '#888', fontWeight: 'bold' }}>
        {label}
      </div>
    )}
    <div className={large ? "big-value" : ""} style={{ fontSize: large ? '1.8vw' : mini ? '1vw' : '1.3vw', fontWeight: '900', lineHeight: '1.1' }}>
      {val?.toFixed(1) || '0.0'}
      <span style={{ fontSize: '0.7vw', color: '#00d4ff', marginLeft: '2px' }}>{unit}</span>
    </div>
  </div>
);

// Komponen Pembungkus Window agar tidak menulis ulang Draggable berkali-kali
const EngineWindow = ({ id, title, children, nodeRef, zIndex, bringToFront, style, animation }) => (
  <Draggable nodeRef={nodeRef} handle=".drag-bar" onStart={() => bringToFront(id)}>
    <div
      ref={nodeRef}
      className="responsive-window"
      style={{ ...windowStyle, ...style, zIndex: zIndex[id], animation: animation || 'none' }}
    >
      <div className="drag-bar" style={dragBarStyle}>
        <span style={titleStyle}>{title}</span>
      </div>
      <div style={contentStyle}>{children}</div>
    </div>
  </Draggable>
);

const App = () => {
  // --- STATES & REFS ---
  const [hoverBtn, setHoverBtn] = useState(null);
  const [hoverExpand, setHoverExpand] = useState(false);
  const [localRPM, setLocalRPM] = useState(400);
  const [localLoad, setLocalLoad] = useState(20);
  const [, setIsSyncing] = useState(false);
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [range, setRange] = useState('5m');
  const [mqttClient, setMqttClient] = useState(null);
  const [isTrendMaximized, setIsTrendMaximized] = useState(false);
  const [showExhDetail, setShowExhDetail] = useState(false);
  const [zIndex, setZIndex] = useState({ control: 1, rpm: 1, exh: 1, load: 1, alarm: 1, params: 1, hist: 1 });

  const controlRef = useRef(null);
  const rpmRef = useRef(null);
  const exhRef = useRef(null);
  const loadRef = useRef(null);
  const alarmRef = useRef(null);
  const paramsRef = useRef(null);
  const histRef = useRef(null);

  // --- FUNCTIONS ---
  const bringToFront = (id) => {
    setZIndex(prev => ({ ...prev, [id]: Math.max(...Object.values(prev)) + 1 }));
  };

  const sendControl = (param, value) => {
    if (mqttClient && mqttClient.connected) {
      const topic = `merry_1331_man_engine/cmd/${param}`;
      mqttClient.publish(topic, value.toString());
    }
  };

  const handleSet = (type, value) => {
    sendControl(type, value);
    setIsSyncing(true);
    setTimeout(() => setIsSyncing(false), 3000);
  };

  const fetchData = useCallback(async () => {
    const queryApi = new InfluxDB({ url, token }).getQueryApi(org);
    const fluxQuery = `from(bucket: "${bucket}") |> range(start: -1m) |> last()`;
    try {
      const results = {};
      for await (const { values, tableMeta } of queryApi.iterateRows(fluxQuery)) {
        const o = tableMeta.toObject(values);
        results[o._field] = o._value;
      }
      setData(results);
    } catch (e) { console.error(e); }
  }, []);

  const fetchHistory = useCallback(async () => {
    const queryApi = new InfluxDB({ url, token }).getQueryApi(org);
    const fluxQuery = `from(bucket: "${bucket}") |> range(start: -${range}) |> filter(fn: (r) => r._field == "rpm") |> aggregateWindow(every: 1s, fn: mean, createEmpty: false) |> yield(name: "mean")`;
    try {
      const rows = [];
      for await (const { values, tableMeta } of queryApi.iterateRows(fluxQuery)) {
        const o = tableMeta.toObject(values);
        rows.push({ time: new Date(o._time).toLocaleTimeString(), rpm: o._value });
      }
      setHistory(rows);
    } catch (e) { console.error(e); }
  }, [range]);

  useEffect(() => {
    const client = mqtt.connect('wss://broker.emqx.io:8084/mqtt');
    client.on('connect', () => setMqttClient(client));
    const interval = setInterval(() => { fetchData(); fetchHistory(); }, 1000);

    const styleSheet = document.createElement("style");
    styleSheet.innerText = blinkerCSS;
    document.head.appendChild(styleSheet);

    return () => { clearInterval(interval); client.end(); };
  }, [fetchData, fetchHistory]);

  // --- RENDER ---
  return (
    <div style={containerStyle}>
      {/* Background */}
      <img
        src="https://i.postimg.cc/50w0qt8m/Adobe-Express-file.png"
        className="bg-image-mobile"
        style={bgImageStyle}
      />

      {/* Header Area */}
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#00d4ff', fontWeight: '900', fontSize: '1.2vw', letterSpacing: '2px' }}>V2.2_ACKERMAN</span>
            <span style={{ color: '#555', fontSize: '0.6vw', fontWeight: 'bold' }}>MAN-DIESEL SHIP PROPULSION</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '30px', alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#00d4ff', fontSize: '1.1vw', fontWeight: '900', fontFamily: 'monospace' }}>{new Date().toLocaleTimeString()}</div>
            <div style={{ color: '#555', fontSize: '0.6vw', fontWeight: 'bold' }}>{new Date().toLocaleDateString()}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #00d4ff', padding: '5px 15px', borderRadius: '4px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#00d4ff' }}></div>
            <span style={{ color: '#00d4ff', fontSize: '0.8vw', fontWeight: 'bold' }}>SYSTEM ONLINE</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="responsive-main" style={mainAreaStyle}>

        {/* Remote Control */}
        <EngineWindow id="control" title="REMOTE CONTROL CENTER" nodeRef={controlRef} zIndex={zIndex} bringToFront={bringToFront} style={{ minHeight: '22vw' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2vw' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ color: '#888', fontSize: '0.7vw', fontWeight: 'bold' }}>ENGINE SPEED SETPOINT</span>
                <span style={{ color: '#00d4ff', fontWeight: 'bold' }}>{localRPM} RPM</span>
              </div>
              <input type="range" min="400" max="1000" value={localRPM} onChange={(e) => setLocalRPM(parseInt(e.target.value))} style={{ width: '100%' }} />
              <button onClick={() => handleSet('rpm', localRPM)} style={loadBtn}>APPLY RPM</button>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ color: '#888', fontSize: '0.7vw', fontWeight: 'bold' }}>ENGINE LOAD SETPOINT</span>
                <span style={{ color: '#00d4ff', fontWeight: 'bold' }}>{localLoad} %</span>
              </div>
              <input type="range" min="0" max="100" value={localLoad} onChange={(e) => setLocalLoad(parseInt(e.target.value))} style={{ width: '100%' }} />
              <button onClick={() => handleSet('load', localLoad)} style={loadBtn}>APPLY LOAD</button>
            </div>
            <button style={{ ...loadBtn, backgroundColor: '#ff4444', marginTop: '1vw' }}>EMERGENCY IDLE</button>
          </div>
        </EngineWindow>

        {/* Engine Speed Gauge */}
        <EngineWindow id="rpm" title="ENGINE SPEED" nodeRef={rpmRef} zIndex={zIndex} bringToFront={bringToFront} animation={data?.rpm > 900 ? 'blinker 1s linear infinite' : 'none'}>
          <div style={{ height: '12vw', marginTop: '-1vw' }}>
            <GaugeComponent
              value={data?.rpm || 0}
              minValue={0}
              maxValue={1200}
              arc={{ subArcs: [{ limit: 400, color: '#555' }, { limit: 900, color: '#00d4ff' }, { limit: 1200, color: '#ff4444' }], width: 0.15 }}
              labels={{ valueLabel: { style: { fontSize: '35px', fill: '#00d4ff', fontWeight: '900' } } }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 1vw' }}>
            <TextVal label="TURBO SPEED" val={(data?.rpm || 0) * 12.5} unit="RPM" mini />
            <TextVal label="EFFICIENCY" val={94.2} unit="%" mini />
          </div>
        </EngineWindow>

        {/* Stack Kanan 1: Exhaust & Load */}
        <div className="responsive-stack" style={rightStackStyle}>
          <EngineWindow id="exh" title="EXHAUST GAS TEMP" nodeRef={exhRef} zIndex={zIndex} bringToFront={bringToFront}>
            <div style={{ cursor: 'pointer' }} onClick={() => setShowExhDetail(!showExhDetail)}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5vw' }}>
                <TextVal label="AVG TEMP" val={data?.exh_t_avg} unit="°C" large />
                <TextVal label="DEVIATION" val={2.4} unit="°C" />
              </div>
              {showExhDetail && (
                <div style={{ marginTop: '1.5vw', paddingTop: '1vw', borderTop: '1px solid #333', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  {[1, 2, 3, 4, 5, 6].map(i => (
                    <TextVal key={i} label={`CYL ${i}`} val={data?.[`exh_t_c${i}`]} unit="°C" mini />
                  ))}
                </div>
              )}
            </div>
          </EngineWindow>

          <EngineWindow id="load" title="ENGINE LOAD STATUS" nodeRef={loadRef} zIndex={zIndex} bringToFront={bringToFront}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1vw' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <TextVal label="CURRENT LOAD" val={data?.load_perc} unit="%" large />
                <TextVal label="TORQUE" val={4200} unit="Nm" />
              </div>
              <div style={{ height: '4px', backgroundColor: '#222', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${data?.load_perc}%`, height: '100%', backgroundColor: '#00d4ff', transition: 'width 0.5s' }}></div>
              </div>
            </div>
          </EngineWindow>
        </div>

        {/* Stack Kanan 2: Alarm & Trend */}
        <div className="responsive-stack" style={rightStackStyle}>
          <EngineWindow id="alarm" title="SYSTEM ALARM" nodeRef={alarmRef} zIndex={zIndex} bringToFront={bringToFront}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8vw' }}>
              <div style={{ padding: '8px', backgroundColor: data?.rpm > 900 ? 'rgba(255,0,0,0.2)' : 'rgba(0,212,255,0.05)', borderLeft: `3px solid ${data?.rpm > 900 ? '#ff4444' : '#00d4ff'}`, borderRadius: '4px' }}>
                <div style={{ fontSize: '0.6vw', color: '#888' }}>{data?.rpm > 900 ? 'CRITICAL' : 'INFO'}</div>
                <div style={{ fontSize: '0.75vw', color: '#fff' }}>{data?.rpm > 900 ? 'OVER SPEED WARNING' : 'SYSTEM OPERATING NORMAL'}</div>
              </div>
            </div>
          </EngineWindow>

          <EngineWindow id="hist" title="TREND ANALYSIS" nodeRef={histRef} zIndex={zIndex} bringToFront={bringToFront} style={{ width: '22vw' }}>
            {{
              expandBtn: (
                <button
                  onMouseEnter={() => setHoverExpand(true)}
                  onMouseLeave={() => setHoverExpand(false)}
                  onClick={() => setIsTrendMaximized(true)}
                  style={{ background: 'none', border: 'none', color: hoverExpand ? '#00d4ff' : '#666', cursor: 'pointer', fontSize: '1.2vw' }}
                >⛶</button>
              ),
              content: (
                <>
                  <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
                    {['5m', '1h', '6h'].map(t => (
                      <button key={t} onClick={() => setRange(t)} style={{ ...rangeBtn, backgroundColor: range === t ? '#00d4ff' : 'transparent', color: range === t ? '#000' : '#888' }}>{t.toUpperCase()}</button>
                    ))}
                  </div>
                  <div style={{ height: '10vw', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                        <XAxis dataKey="time" hide />
                        <YAxis stroke="#444" fontSize={10} domain={[300, 1100]} />
                        <Tooltip contentStyle={{ backgroundColor: '#000', border: '1px solid #333' }} />
                        <Line type="monotone" dataKey="rpm" stroke="#00d4ff" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )
            }}
          </EngineWindow>
        </div>

      </main>

      {/* Overlay Fullscreen Trend */}
      {isTrendMaximized && (
        <div style={fullScreenOverlay}>
          <div style={{ width: '90%', height: '80%', backgroundColor: '#052d38', padding: '40px', borderRadius: '20px', position: 'relative', border: '1px solid #00d4ff' }}>
            <button onClick={() => setIsTrendMaximized(false)} style={{ position: 'absolute', right: '20px', top: '20px', background: 'none', border: 'none', color: '#ff4444', fontSize: '24px', cursor: 'pointer' }}>✕</button>
            <h2 style={{ color: '#00d4ff', marginBottom: '20px' }}>HISTORICAL ENGINE SPEED DATA ({range.toUpperCase()})</h2>
            <div style={{ height: '85%', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#111" />
                  <XAxis dataKey="time" stroke="#444" />
                  <YAxis stroke="#444" domain={[300, 1100]} />
                  <Tooltip contentStyle={{ backgroundColor: '#000', border: '1px solid #00d4ff' }} />
                  <Line type="monotone" dataKey="rpm" stroke="#00d4ff" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer style={footerStyle}>
        <div style={footerLine}></div>
        <div className="footer-content-mobile" style={footerContent}>
          <span>ENGINEERED BY <strong style={{ color: '#aaa' }}>MARTUA_MANULANG</strong></span>
          <span style={{ opacity: 0.8 }}>© 2026 DIGITAL TWIN FRAMEWORK PROTOTYPE</span>
        </div>
      </footer>
    </div>
  );
};

// STYLES OBJECTS
const containerStyle = { minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', backgroundColor: '#052d38', overflowX: 'hidden' };
const bgImageStyle = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '48vw', opacity: '0.4', zIndex: 0, pointerEvents: 'none', userSelect: 'none' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1vw 2vw', borderBottom: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(10px)', zIndex: 10 };
const mainAreaStyle = { display: 'flex', justifyContent: 'space-between', padding: '1.5vw', flexGrow: 1, zIndex: 5, position: 'relative', gap: '1.5vw' };
const rightStackStyle = { display: 'flex', flexDirection: 'column', gap: '1.5vw' };
const windowStyle = { backgroundColor: 'rgba(0, 0, 0, 0.3)', backdropFilter: 'blur(5px)', borderRadius: '22px', border: '2px solid #85858511', boxShadow: '0 4px 30px rgba(0, 0, 0, 0.13)', width: '18vw', minWidth: '250px', height: 'fit-content', overflow: 'hidden' };
const dragBarStyle = { padding: '0.8vw 1.2vw', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'grab', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const contentStyle = { padding: '1.2vw' };
const titleStyle = { color: '#888', fontSize: '0.65vw', fontWeight: 'bold', letterSpacing: '1.5px' };
const loadBtn = { marginTop: '10px', width: '100%', padding: '10px', backgroundColor: '#00d4ff', border: 'none', borderRadius: '4px', color: '#000', fontWeight: 'bold', cursor: 'pointer' };
const rangeBtn = { padding: '4px 10px', border: '1px solid #333', borderRadius: '4px', cursor: 'pointer', fontSize: '10px' };
const fullScreenOverlay = { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' };
const footerStyle = { padding: '0.5vw 2vw', zIndex: 10 };
const footerLine = { height: '1px', background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.3), transparent)', marginBottom: '0.5vw' };
const footerContent = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.65vw', color: '#aaa', letterSpacing: '1px' };

const blinkerCSS = `
  @keyframes blinker { 0% { background-color: rgba(0, 0, 0, 0.3); } 50% { background-color: #ff0000; } 100% { background-color: rgba(0, 0, 0, 0.3); } }
  .alarm-blink { animation: blinker 1s linear infinite !important; }
  input[type=range] { -webkit-appearance: none; background: transparent; }
  input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 4px; background: #333; border-radius: 2px; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; height: 16px; width: 16px; border-radius: 50%; background: #00d4ff; cursor: pointer; margin-top: -6px; box-shadow: 0 0 10px #00d4ff; }
  
  @media (max-width: 1024px) {
    .responsive-main { flex-direction: column !important; align-items: center !important; gap: 20px !important; }
    .responsive-window { width: 92vw !important; position: static !important; transform: none !important; }
    .responsive-stack { width: 100% !important; align-items: center !important; gap: 20px !important; }
    header, footer { padding: 15px 20px !important; height: auto !important; }
    .footer-content-mobile { flex-direction: column !important; gap: 10px; text-align: center; }
    span, div, button { font-size: 14px !important; }
    .big-value { font-size: 28px !important; }
    .mini-label { font-size: 11px !important; }
  }
`;

export default App;