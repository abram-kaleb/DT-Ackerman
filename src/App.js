import React, { useState, useEffect, useCallback, useRef } from 'react';
import GaugeComponent from 'react-gauge-component';
import Draggable from 'react-draggable';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import mqtt from 'mqtt';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const App = () => {
  const sendControl = (param, value) => { if (mqttClient && mqttClient.connected) { const topic = `merry_1331_man_engine/cmd/${param}`; mqttClient.publish(topic, value.toString()); console.log(`Command Sent: ${topic} -> ${value}`); } else { console.error("MQTT not connected"); } };
  const handleSet = (type, value) => { sendControl(type, value); setIsSyncing(true); setTimeout(() => setIsSyncing(false), 3000); };
  const [hoverBtn, setHoverBtn] = useState(null);
  const [hoverExpand, setHoverExpand] = useState(false);
  const [localRPM, setLocalRPM] = useState(400);
  const [localLoad, setLocalLoad] = useState(20);
  const [, setIsSyncing] = useState(false);
  const [data, setData] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedField, setSelectedField] = useState('rpm');
  const [timeRange, setTimeRange] = useState('-1h');
  const [alarms, setAlarms] = useState([]);
  const [connStatus, setConnStatus] = useState('connection lost');
  const [showExhDetail, setShowExhDetail] = useState(false);
  const [isTrendMaximized, setIsTrendMaximized] = useState(false);
  const rpmRef = useRef(null);
  const loadRef = useRef(null);
  const exhRef = useRef(null);
  const paramRef = useRef(null);
  const histRef = useRef(null);
  const alarmRef = useRef(null);
  const [hasInitialSync, setHasInitialSync] = useState(false);
  const [mqttClient, setMqttClient] = useState(null);
  const controlRef = useRef(null); // Ref untuk jendela kontrol


  useEffect(() => {



    if (data && !hasInitialSync) {
      if (data.rpm) setLocalRPM(Math.round(data.rpm));
      if (data.load) setLocalLoad(Math.round(data.load));
      setHasInitialSync(true);
      console.log("Initial slider sync completed with live data");
    }
  }, [data, hasInitialSync]);

  const [zIndex, setZIndex] = useState({ rpm: 1, load: 1, params: 1, hist: 1, alarm: 1, control: 1 });
  const bringToFront = (id) => setZIndex(prev => ({ ...prev, [id]: Math.max(...Object.values(prev)) + 1 }));
  const clearAlarm = (id) => setAlarms(prev => prev.filter(a => a.id !== id));

  const fetchData = useCallback(async () => {
    try {
      const { data: logs, error } = await supabase
        .from('engine_monitor')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;

      if (logs) {
        setData(logs);
        setConnStatus('online');

        const detected = [];
        // Gunakan 'logs' bukan 'o'
        if (logs.oil_p < 2.5) detected.push({ id: 'oil_p', msg: 'LOW LUBE OIL PRESS', sev: 'HIGH' });
        if (logs.rpm > 900) detected.push({ id: 'rpm_high', msg: 'ENGINE OVERSPEED', sev: 'CRITICAL' });
        if (logs.load > 90) detected.push({ id: 'load_high', msg: 'HIGH ENGINE LOAD', sev: 'HIGH' });
        if (logs.exh_t_avg > 450) detected.push({ id: 'exh_high', msg: 'HIGH EXHAUST TEMP', sev: 'HIGH' });

        setAlarms(prev => {
          const existingIds = prev.map(a => a.id);
          const filteredNew = detected.filter(a => !existingIds.includes(a.id));
          return [...prev, ...filteredNew];
        });
      }
    } catch (err) {
      console.error("Fetch Error:", err);
      setConnStatus('OFFLINE');
    }
    // Karena kita pakai Realtime Subscription nanti, 
    // kita tidak butuh setTimeout(fetchData, 1000) lagi di sini.
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const now = new Date();
      let startTime;

      // Tambahkan kondisi -15m agar sesuai dengan dropdown di UI Anda
      if (timeRange === '-5m') startTime = new Date(now.getTime() - 5 * 60000);
      else if (timeRange === '-15m') startTime = new Date(now.getTime() - 15 * 60000); // Perbaikan: Tambahkan ini
      else if (timeRange === '-1h') startTime = new Date(now.getTime() - 60 * 60000);
      else if (timeRange === '-24h') startTime = new Date(now.getTime() - 24 * 60 * 60000);
      else if (timeRange === '-7d') startTime = new Date(now.getTime() - 7 * 24 * 60 * 60000);
      else if (timeRange === '-30d') startTime = new Date(now.getTime() - 30 * 24 * 60 * 60000);
      else startTime = new Date(now.getTime() - 60 * 60000);

      const { data: history, error } = await supabase
        .from('engine_monitor')
        .select(`created_at, ${selectedField}`)
        .gte('created_at', startTime.toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (history) {
        const formatted = history.map(item => {
          const dateObj = new Date(item.created_at);

          // Perbaikan format label: Tambahkan detik untuk range pendek agar grafik terlihat bergerak
          const isShortRange = timeRange === '-5m' || timeRange === '-15m';
          const timeLabel = (timeRange === '-30d' || timeRange === '-7d')
            ? `${dateObj.getDate()}/${dateObj.getMonth() + 1} ${dateObj.getHours()}:00`
            : dateObj.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: isShortRange ? '2-digit' : undefined
            });

          return {
            time: timeLabel,
            value: item[selectedField]
          };
        });

        setHistoryData(formatted);
      }
    } catch (err) {
      console.error("History Error:", err);
    } finally {
      setLoadingHistory(false);
    }
  }, [selectedField, timeRange]);




  useEffect(() => {
    // 1. Setup MQTT Connection
    const client = mqtt.connect('wss://broker.emqx.io:8084/mqtt');
    client.on('connect', () => {
      console.log('Connected to MQTT Broker');
      setMqttClient(client);
    });

    client.on('error', (err) => {
      console.error('MQTT Connection Error: ', err);
      client.end();
    });

    // 2. Setup Realtime Supabase Subscription
    const channel = supabase
      .channel('engine_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'engine_monitor' },
        // Di dalam useEffect Supabase .on('postgres_changes', ...)
        // Di dalam listener postgres_changes
        (payload) => {
          setData(payload.new);
          setConnStatus('online');

          setHistoryData((prev) => {
            const dateObj = new Date(payload.new.created_at);
            const newLabel = dateObj.toLocaleTimeString([], {
              hour: '2-digit', minute: '2-digit', second: '2-digit'
            });

            const newPoint = {
              time: newLabel,
              value: payload.new[selectedField]
            };

            // Ambil 50 data terakhir. 
            // Karena ukurannya tetap, grafik akan terlihat bergeser ke kiri.
            const newData = [...prev, newPoint];
            if (newData.length > 50) {
              return newData.slice(1); // Buang data paling lama
            }
            return newData;
          });
        }
      )
      .subscribe();

    // 3. Inject CSS & Initial Data Fetch
    const styleSheet = document.createElement("style");
    styleSheet.innerText = blinkerCSS;
    document.head.appendChild(styleSheet);

    fetchData();    // Ambil status terakhir
    fetchHistory(); // Ambil riwayat untuk chart

    // 4. CLEANUP FUNCTION (PENTING!)
    // Fungsi ini berjalan saat komponen ditutup atau direfresh
    return () => {
      supabase.removeChannel(channel);
      if (client) client.end();
      if (document.head.contains(styleSheet)) {
        document.head.removeChild(styleSheet);
      }
    };

    // Ditambahkan 'selectedField' agar listener realtime sinkron dengan pilihan user
  }, [fetchData, fetchHistory, selectedField]);


  return (
    <div style={containerStyle}> <img src="https://i.postimg.cc/50w0qt8m/Adobe-Express-file.png" alt="Engine Background" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '45vw', opacity: '1', zIndex: 0, pointerEvents: 'none', userSelect: 'none' }} />
      <header style={{ ...headerStyle, flexWrap: 'wrap', minHeight: '60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', color: '#fff' }}>


          {/* Section Waktu & Tanggal */}
          <div style={{ textAlign: 'left', borderRight: '1px solid rgba(255,255,255,0.2)', paddingRight: '15px' }}><div style={{ fontSize: 'clamp(14px, 1.1vw, 22px)' }}>
            {data ? new Date(data.created_at).toLocaleTimeString([], { hour12: false }) : '--:--:--'}</div>
            <div style={{ fontSize: 'clamp(10px, 0.65vw, 14px)', }}>{data ? new Date(data.created_at).toLocaleDateString() : '---'}
            </div>
          </div>

          {/* Section Nama Mesin */}
          <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 'clamp(14px, 1.1vw, 22px)', fontWeight: '900', color: '#fff', letterSpacing: '1px' }}>MAN 5LYY/30H</span><span style={{ fontSize: 'clamp(9px, 0.55vw, 12px)', color: '#00d4ff', fontWeight: 'bold' }}>DIGITAL TWIN PROTOTYPE</span>
          </div>
        </div>

        {/* Section Versi & Status */}<div style={{ textAlign: 'right', color: '#fff' }}><div style={{ fontSize: 'clamp(12px, 1.1vw, 20px)', fontWeight: '900', color: '#ffffff' }}>v2.3_ackerman
        </div>
          <div style={{ fontSize: 'clamp(11px, 0.8vw, 16px)', color: connStatus === 'online' ? '#00ff40' : '#ff4444', fontWeight: 'bold' }}>{connStatus.toUpperCase()}
          </div>
        </div>
      </header>


      <Draggable nodeRef={controlRef} handle=".drag-bar" onStart={() => bringToFront('control')}>
        <div ref={controlRef} className="" style={{ ...windowStyle, left: '25px', top: '100px', minheight: '22vw', width: '8.5vw', zIndex: zIndex.control }}>
          <div className="drag-bar" style={{ ...dragBarStyle, buttomlineborder: '1px solid rgba(255, 255, 255, 1)', backgroundColor: '#00c431' }}>
            <span style={titleStyle}>Remote Control</span>
          </div>
          <div style={{ padding: '1vw', display: 'flex', flexDirection: 'column', gap: '1.2vw' }}>
            <div style={{ borderBottom: '1px solid #333', pb: '1vw' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', mb: '5px' }}>
                <span style={{ color: '#ffffff', fontSize: '0.7vw' }}>RPM</span>
                <span style={{ color: '#fff', fontWeight: 'bold' }}>{localRPM}</span>
              </div>

              <input
                type="range" min="400" max="1000" step="1"
                value={localRPM}
                onChange={(e) => setLocalRPM(parseInt(e.target.value))}
                style={sliderStyle}
              />

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' }}>
                <button
                  onMouseEnter={() => setHoverBtn('rpm')} onMouseLeave={() => setHoverBtn(null)} onClick={() => handleSet('rpm', localRPM)} style={{ ...loadBtn, flex: 1, py: '5px', fontSize: '0.7vw', cursor: 'pointer', transition: 'all 0.2s ease', backgroundColor: hoverBtn === 'rpm' ? '#00c431' : '#333', color: hoverBtn === 'rpm' ? '#000' : '#fff', boxShadow: hoverBtn === 'rpm' ? '0 0 15px #00c431' : 'none', }}>Set
                </button>

                {Math.abs((data?.rpm || 0) - localRPM) > 2 ? (
                  <span style={{ color: '#ffaa00', fontSize: '0.65vw', letterSpacing: '0.5px', fontFamily: "'Inter',sans-serif", animation: 'blink 1s infinite' }}>● Sync {localRPM}
                  </span>
                ) : null}
              </div>
            </div>

            <div style={{ borderBottom: '1px solid #333', pb: '1vw' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', mb: '5px' }}>
                <span style={{ color: '#ffffff', fontSize: '0.7vw' }}>Load</span>
                <span style={{ color: '#fff', fontWeight: 'bold' }}>{localLoad}</span>
              </div>

              <input
                type="range" min="0" max="100" step="1"
                value={localLoad}
                onChange={(e) => setLocalLoad(parseInt(e.target.value))}
                style={sliderStyle}
              />
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' }}>
                <button
                  onMouseEnter={() => setHoverBtn('load')}
                  onMouseLeave={() => setHoverBtn(null)}
                  onClick={() => handleSet('load', localLoad)}
                  style={{
                    ...loadBtn,
                    width: '100%',
                    mt: '10px',
                    py: '5px',
                    fontSize: '0.7vw',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    backgroundColor: hoverBtn === 'load' ? '#00c431' : '#333',
                    color: hoverBtn === 'load' ? '#000' : '#fff',
                    boxShadow: hoverBtn === 'load' ? '0 0 15px #00c431' : 'none',
                  }}>Set
                </button>


                {Math.abs((data?.load || 0) - localLoad) > 2 ? (
                  <span style={{
                    color: '#ffaa00',
                    fontSize: '0.65vw',
                    letterSpacing: '0.5px', fontFamily: "'Inter',sans-serif",
                    animation: 'blink 1s infinite'
                  }}>
                    ● Sync {localLoad}
                  </span>
                ) : null}
              </div>
            </div>


            <button
              onMouseEnter={() => setHoverBtn('emergency')}
              onMouseLeave={() => setHoverBtn(null)}
              onClick={() => {

                handleSet('rpm', 400);
                handleSet('load', 0);


                setLocalRPM(400);
                setLocalLoad(0);

                console.warn("EMERGENCY IDLE ACTIVATED: Resetting to 400 RPM / 0% Load");
              }}
              style={{
                ...loadBtn,
                backgroundColor: hoverBtn === 'emergency' ? '#ff0000' : '#333',
                color: '#ffffff',
                marginTop: '0.5vw',
                fontSize: '15px',
                width: '100%',
                height: '200%',
                fontWeight: 'bold',

                boxShadow: hoverBtn === 'emergency' ? '0 0 20px #ff0000' : 'none',
                transition: 'all 0.3s ease',
                cursor: 'pointer'
              }}
            >
              <i className="fas fa-exclamation-triangle"></i> Emergency Idle
            </button>
          </div>
        </div>
      </Draggable>


      <Draggable nodeRef={rpmRef} handle=".drag-bar" onStart={() => bringToFront('rpm')}>
        <div ref={rpmRef} style={{ ...windowStyle, left: '350px', top: '180px', width: '18vw', zIndex: zIndex.rpm, animation: (data?.rpm > 900) ? 'blinker 1s linear infinite' : 'none' }}>
          <div className="drag-bar" style={dragBarStyle}><span style={titleStyle}>Engine Speed</span></div>
          <div style={{ ...contentStyle, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ marginBottom: '-1vw', textAlign: 'center', zIndex: 2 }}>
              <span style={{ fontSize: '2vw', fontWeight: '900', color: '#00d4ff' }}>{data?.rpm || 0}</span>
              <span style={{ fontSize: '0.8vw', color: '#00d4ff', marginLeft: '0.3vw' }}>RPM</span>
            </div>
            <div style={{ width: '100%' }}>
              <GaugeComponent
                style={{ width: '90%', margin: '0 auto' }}
                value={data?.rpm || 0}
                maxValue={1000}
                type="radial"
                arc={{
                  width: 0.15,
                  padding: 0.02,
                  subArcs: [
                    { limit: 900, color: '#00d4ff' },
                    { limit: 1000, color: '#EA4228' }
                  ]
                }}
                pointer={{ type: "needle", color: "#ffffff", baseColor: "#ffffff", width: 15 }}
                labels={{
                  valueLabel: { hide: true },
                  tickLabels: {
                    type: "outer",
                    hideMinMax: false,
                    ticks: [
                      { value: 0 }, { value: 400 },
                      { value: 900 }, { value: 1000 }
                    ],
                    defaultTickValueConfig: {
                      style: { fill: "#ffffff", fontSize: "10px" }
                    }
                  }
                }}
              />
            </div>
          </div>
        </div>
      </Draggable>




      <Draggable nodeRef={exhRef} handle=".drag-bar" onStart={() => bringToFront('exh')}>
        <div ref={exhRef} style={{ ...windowStyle, right: '450px', top: '400px', width: '14vw', zIndex: zIndex.exh, animation: (data?.exh_t_avg > 450) ? 'blinker 1s linear infinite' : 'none' }}>
          <div className="drag-bar" style={dragBarStyle}><span style={titleStyle}>Exhaust Temp</span></div>
          <div
            onClick={() => setShowExhDetail(!showExhDetail)}
            style={{ ...contentStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}          >
            <div style={{ marginBottom: '-1vw', textAlign: 'center', zIndex: 2 }}>
              <span style={{ fontSize: '2vw', fontWeight: '900', color: '#00d4ff' }}>
                {data?.exh_t_avg ? Math.round(data.exh_t_avg) : "0"}
              </span>
              <span style={{ fontSize: '0.8vw', color: '#ffffffff', marginLeft: '0.3vw' }}>
                °C {showExhDetail ? '▴' : '▾'}
              </span>
            </div>

            <div style={{ width: '100%' }}>
              <GaugeComponent
                style={{ width: '80%', margin: '0 auto' }}
                value={data?.exh_t_avg || 0}
                maxValue={600}
                type="semicircle"
                arc={{
                  width: 0.15,
                  padding: 0.02,
                  subArcs: [
                    { limit: 450, color: '#00d4ff' },
                    { limit: 600, color: '#EA4228' }
                  ]
                }}
                pointer={{ type: "needle", color: "#ffffff", baseColor: "#ffffff", width: 15 }}
                labels={{
                  valueLabel: { hide: true },
                  tickLabels: {
                    type: "outer",
                    ticks: [{ value: 0 }, { value: 450 }, { value: 600 }],
                    defaultTickValueConfig: { style: { fill: "#ffffff", fontSize: "10px" } }
                  }
                }}
              />
            </div>


            {showExhDetail && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '0.5vw',
                width: '100%',
                marginTop: '0.5vw',
                padding: '0.5vw',
                backgroundColor: 'rgba(0,0,0,0.5)',
                borderRadius: '8px',
                border: '1px solid rgba(0,212,255,0.2)'
              }}>
                <TextVal label="C1" val={data?.exh_t_c1} unit="" mini />
                <TextVal label="C2" val={data?.exh_t_c2} unit="" mini />
                <TextVal label="C3" val={data?.exh_t_c3} unit="" mini />
                <TextVal label="C4" val={data?.exh_t_c4} unit="" mini />
                <TextVal label="C5" val={data?.exh_t_c5} unit="" mini />
                <TextVal label="C6" val={data?.exh_t_c6} unit="" mini />
              </div>
            )}
          </div>
        </div>
      </Draggable>

      <Draggable nodeRef={loadRef} handle=".drag-bar" onStart={() => bringToFront('load')}>
        <div ref={loadRef} style={{ ...windowStyle, right: '450px', top: '150px', width: '14vw', zIndex: zIndex.load, animation: (data?.load > 90) ? 'blinker 1s linear infinite' : 'none' }}>
          <div className="drag-bar" style={dragBarStyle}><span style={titleStyle}>Engine Load</span></div>
          <div style={{ ...contentStyle, padding: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ marginBottom: '-1vw', textAlign: 'center', zIndex: 2 }}>
              <span style={{ fontSize: '2vw', fontWeight: '900', color: '#00d4ff' }}>
                {data?.load ? data.load.toFixed(2) : "0.00"}
              </span>
              <span style={{ fontSize: '0.8vw', color: '#ffffffff', marginLeft: '0.3vw' }}>%</span>
            </div>
            <div style={{ width: '100%' }}>
              <GaugeComponent
                style={{ width: '80%', margin: '0 auto' }}
                value={data?.load || 0}
                type="semicircle"
                arc={{
                  width: 0.15,
                  padding: 0.02,
                  subArcs: [
                    { limit: 90, color: '#00d4ff' },
                    { limit: 100, color: '#EA4228' }
                  ]
                }}
                pointer={{ type: "needle", color: "#ffffff", baseColor: "#ffffff", width: 15 }}
                labels={{
                  valueLabel: { hide: true },
                  tickLabels: {
                    type: "outer",
                    ticks: [
                      { value: 90 }, { value: 100 }
                    ],
                    defaultTickValueConfig: {
                      style: { fill: "#ffffff", fontSize: "10px" }
                    }
                  }
                }}
              />
            </div>
          </div>
        </div>
      </Draggable>


      <Draggable nodeRef={alarmRef} handle=".drag-bar" onStart={() => bringToFront('alarm')}>
        <div ref={alarmRef} style={{ ...windowStyle, right: '20px', top: '100px', height: 'auto', zIndex: zIndex.alarm }}>
          <div className="drag-bar" style={{ ...dragBarStyle, backgroundColor: alarms.length > 0 ? 'rgb(255, 0, 0)' : '#EA4228' }}>
            <span style={titleStyle}>Alarm ({alarms.length})</span>
          </div>
          <div style={{ padding: '0.6vw', overflowY: 'auto' }}>
            {alarms.length === 0 ? <div style={{ fontSize: '0.8vw', textAlign: 'center', color: 'rgba(255, 255, 255, 0.36)', padding: '0.5vw' }}>System Normal</div> :
              alarms.map(a => <div key={a.id} style={alarmBoxSlim}><span>[ {a.sev} ] {a.msg}</span><button onClick={() => clearAlarm(a.id)} style={clearBtn}>ACK</button></div>)
            }
          </div>
        </div>
      </Draggable>

      <Draggable nodeRef={paramRef} handle=".drag-bar" onStart={() => bringToFront('params')}>
        <div ref={paramRef} style={{ ...windowStyle, right: '20px', top: '350px', width: '11vw', zIndex: zIndex.params }}>
          <div className="drag-bar" style={dragBarStyle}><span style={titleStyle}>Parameters</span></div>
          <div style={{ padding: '0.8vw' }}>
            <div style={{ marginBottom: '1vw' }}>
              <div style={categoryLabel}>Fuel Rate</div>
              <TextVal val={data?.fuel_rate} unit="kg/h" large />
            </div>
            <div style={categoryLabel}>Pressure</div>
            <div style={textGrid}>
              <TextVal
                label="LUBE"
                val={data?.oil_p}
                unit="Bar"
                style={{ animation: (data?.oil_p < 3.0) ? 'blinker 1s linear infinite' : 'none' }}
              />
              <TextVal
                label="SW"
                val={data?.sw_p}
                unit="Bar"
                style={{ animation: (data?.sw_p < 1.0) ? 'blinker 1s linear infinite' : 'none' }}
              />
            </div>
            <div style={{ ...categoryLabel, marginTop: '1vw' }}>Temperature</div>
            <div style={textGrid}>
              <TextVal
                label="OIL"
                val={data?.oil_t}
                unit="°C"
                style={{ animation: (data?.oil_t > 90) ? 'blinker 1s linear infinite' : 'none' }}
              />
              <TextVal
                label="CW"
                val={data?.cw_t}
                unit="°C"
                style={{ animation: (data?.cw_t > 92) ? 'blinker 1s linear infinite' : 'none' }}
              />
            </div>
          </div>
        </div>
      </Draggable>


      <Draggable nodeRef={histRef} handle=".drag-bar" onStart={() => bringToFront('hist')}>
        <div ref={histRef}
          onClick={() => !isTrendMaximized && setIsTrendMaximized(true)}

          style={{ ...windowStyle, bottom: '50px', left: '25px', width: '24vw', zIndex: zIndex.hist }}>

          <div className="drag-bar" style={dragBarStyle}>
            <span style={titleStyle}>Trend: {selectedField.toUpperCase()}</span>


          </div>
          <div style={{ height: '14vh', padding: '0.5vw' }}>
            <ResponsiveContainer width="100%" height="100%" debounce={50}>
              <LineChart data={historyData}>
                <CartesianGrid stroke="#333" vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  hide={!isTrendMaximized}
                  interval="preserveStartEnd" // Menjaga label tetap rapi saat bergeser
                />
                <YAxis
                  domain={['auto', 'auto']}
                  hide={!isTrendMaximized}
                  allowDecimals={true}
                />
                <Line
                  type="linear" // Gunakan linear agar garis tegas, atau "monotone" untuk smooth
                  dataKey="value"
                  stroke="#00d4ff"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false} // WAJIB FALSE: Agar garis langsung muncul tanpa animasi gerak
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Draggable>

      {
        isTrendMaximized && (
          <div style={fullScreenOverlay}>
            <div style={{
              ...windowStyle,
              width: '70vw',
              height: '90vh',
              backgroundColor: 'rgba(10, 10, 10, 0.4)',
              backdropFilter: 'blur(15px)',
              border: '1px solid rgba(255,255,255,0.1)'
            }}>
              <div style={dragBarStyle}>
                <span style={{ fontSize: '1.2vw', fontWeight: 'bold', color: '#00d4ff' }}>Trend Analysis</span>
                <div style={{ display: 'flex', gap: '0.8vw' }}>
                  <select value={selectedField} onChange={e => setSelectedField(e.target.value)} style={selectStyle}>
                    <option value="rpm">Speed (RPM)</option><option value="load">Load (%)</option>
                    <option value="fuel_rate">Fuel Rate (kg/h)</option><option value="oil_p">Oil Pressure (Bar)</option>
                  </select>
                  <select value={timeRange} onChange={e => setTimeRange(e.target.value)} style={selectStyle}>
                    <option value=
                      "-5m">5 Min</option><option value=
                        "-15m">15 Min</option><option value=
                          "-1h">1 Hour</option><option value=
                            "-24h">24 Hour</option>
                    <option value="-7d">7 Days</option>
                    <option value="-30d">30 Days</option>
                  </select>
                  <button onClick={fetchHistory} style={loadBtn}>{loadingHistory ? 'LOADING...' : 'REFRESH'}</button>
                  <button onClick={() => setIsTrendMaximized(false)} style={{ ...loadBtn, backgroundColor: '#ff4444' }}>X</button>
                </div>
              </div>
              <div style={{ height: '75vh', padding: '2vw' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyData}>
                    <CartesianGrid stroke="#222" strokeDasharray="3 3" />
                    <XAxis dataKey="time" stroke="#666" fontSize="0.8vw" />
                    <YAxis stroke="#666" fontSize="0.8vw" domain={['auto', 'auto']} width={40} />
                    <Tooltip contentStyle={{ backgroundColor: '#000', border: '1px solid #00d4ff' }} />
                    <Line type="monotone" dataKey="value" stroke="#00d4ff" strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )
      }

      <footer style={{ ...footerStyle, padding: '10px 0' }}>
        <div style={footerLine}></div>
        <div style={{
          ...footerContent,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap', // Agar teks turun ke bawah jika layar sangat sempit
          gap: '10px',
          padding: '0 20px'
        }}>
          <span style={{
            fontSize: 'clamp(10px, 0.7vw, 14px)', // Batas bawah 10px
            color: '#888'
          }}>
            Engineered By <strong style={{ color: '#aaa' }}>Martua_Manulang</strong>
          </span>

          <span style={{
            fontSize: 'clamp(9px, 0.6vw, 12px)', // Batas bawah 9px
            opacity: 0.8,
            textAlign: 'right'
          }}>
            © 2026 DIGITAL TWIN PROTOTYPE • ALL RIGHTS RESERVED
          </span>
        </div>
      </footer>
    </div >
  );
};

const TextVal = ({ label, val, unit, large, mini }) => (<div style={{ color: '#00d4ff' }}>    {label && <div className="mini-label" style={{ fontSize: mini ? '0.5vw' : '0.6vw', color: '#888', fontWeight: 'bold' }}>{label}</div>}    <div className={large ? "big-value" : ""} style={{ fontSize: large ? '1.5vw' : mini ? '1vw' : '1.5vw', fontWeight: '900', lineHeight: '1.1' }}>    {val?.toFixed(1) || '0.0'}      <span style={{ fontSize: '0.7vw', color: '#00d4ff', marginLeft: '2px' }}>{unit}</span>    </div>  </div>);
const containerStyle = { minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#202020', position: 'relative', overflowX: 'hidden' };
const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1vw 2vw', borderBottom: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(0, 0, 0, 0)', backdropFilter: 'blur(0px)',
  letterSpacing: '0.5px', fontFamily: "'Inter',sans-serif"
};
const mainAreaStyle = { display: 'flex', flexDirection: 'row', justifyContent: 'center', padding: '1.5vw', flexGrow: 1, flexWrap: 'wrap' };
const rightStackStyle = { display: 'flex', flexDirection: 'column', gap: '1.5vh', alignItems: 'center' };
const windowStyle = { position: 'absolute', backgroundColor: 'rgba(0, 0, 0, 0.04)', backdropFilter: 'blur(10px)', borderRadius: '10px', border: '2px solid #85858511', boxShadow: '0 4px 30px rgba(0, 0, 0, 0.13)', width: '14vw', minWidth: '200px', height: 'fit-content', flexShrink: 0, };
const dragBarStyle = {
  backgroundColor: 'rgb(0, 0, 0)', padding: '0.6vw 1vw', borderRadius: '8px 8px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'grab',
  letterSpacing: '0.5px', fontFamily: "'Inter',sans-serif", height: '5px'
};
const titleStyle = { fontSize: '0.9vw', fontWeight: 'bold', color: '#eee' };
const contentStyle = { padding: '0.5vw' };
const categoryLabel = {
  fontSize: '1.2vw', color: '#ffffffff', fontWeight: 'bold', borderBottom: '1px solid rgba(0,212,255,0.3)', marginBottom: '0.5vw', letterSpacing: '0.5px', fontFamily: "'Inter',sans-serif"
};
const textGrid = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.8vw' };
const alarmBoxSlim = { backgroundColor: 'rgba(255, 247, 247, 0.98)', borderLeft: '3px solid #ff4444', padding: '0.4vw 0.8vw', marginBottom: '0.4vw', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8vw', color: '#ff4444' };
const sliderStyle = { appearance: 'none', width: '100%', height: '8px', background: '#000000ff', borderRadius: '4px', outline: 'none', boxShadow: 'inset 0 0 5px #000', marginTop: '10px', marginBottom: '10px', cursor: 'pointer' };
const clearBtn = { backgroundColor: '#440000', border: '1px solid #f00', color: '#fff', cursor: 'pointer', fontSize: '0.55vw', padding: '0.2vw 0.5vw' };
const selectStyle = { backgroundColor: '#000', color: '#00d4ff', fontSize: '0.8vw', border: '1px solid #444', borderRadius: '4px', padding: '2px 5px' };
const loadBtn = { backgroundColor: '#00d4ff', border: 'none', padding: '0.3vw 0.8vw', fontSize: '0.7vw', fontWeight: '900', cursor: 'pointer', borderRadius: '4px' };
const fullScreenOverlay = { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' };
const footerStyle = {
  marginTop: 'auto', // Mendorong footer ke paling bawah dalam flexbox
  padding: '1vw 2vw',
  backgroundColor: 'rgba(0, 0, 0, 0)', // Beri sedikit opacity agar teks modul yang lewat di bawahnya tidak mengganggu
  backdropFilter: 'blur(0px)',
  zIndex: 100, // Pastikan di atas modul agar tidak tertutup
  width: '100%',
  position: 'fixed', // Opsi terbaik jika dashboard Anda penuh modul
  bottom: 0,
  left: 0
};
const footerLine = { height: '1px', background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.3), transparent)', marginBottom: '0.5vw' };
const footerContent = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.65vw', color: '#aaa',
  letterSpacing: '0.5px', fontFamily: "'Inter',sans-serif"
};
const startingIndicatorStyle = {
  position: 'absolute',
  top: '20px',    // Sesuaikan jarak dari atas kontainer
  left: '20px',   // Sesuaikan jarak dari kiri kontainer
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  zIndex: 10,      // Pastikan berada di atas elemen lain
  padding: '10px',
  background: 'rgba(0, 0, 0, 0.5)',
  borderRadius: '4px',
  borderLeft: '3px solid #00d4ff'
};

const blinkerCSS = `
{
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
  {font-family:'Inter', sans-serif;}
 .big-value, .mini-label { letterSpacing:'0.5px',fontFamily:"'Inter',sans-serif"; }
 header span:first-child, .drag-bar span { font-family: 'Michroma', sans-serif; }
  }

   @keyframes blinker { 0% { background-color: transparent; } 50% { background-color: #ff4444; } 100% { background-color: transparent; } }
  html, body { background-color: #052d38; margin: 0; padding: 0; }
  input[type=range] { -webkit-appearance: none; background: transparent; }
    input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 8px; background: #333; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; height: 16px; width: 16px; border-radius: 50%; background: #00c431; margin-top: -6px; }
  
  

`;



export default App;
