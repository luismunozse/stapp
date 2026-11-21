import React from 'react';
import {AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {Phone as PhoneIcon, PhoneMissed, Wrench, CheckCircle2, CheckCheck, MessageCircle} from 'lucide-react';
import {Bg, CTA, Highlight, Phone, Pill, Scene, Title, easeOut} from './kit';
import {C, SHADOW} from './brand';

// Video 1 · "El cliente que llama 10 veces" (problema → solución)
export const V1_SCENES = [105, 90, 210, 180, 75, 150];
export const V1_DUR = V1_SCENES.reduce((a, b) => a + b, 0);

const Call: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const n = Math.min(10, 1 + Math.floor(interpolate(f, [8, 85], [0, 9.99], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})));
  const shake = Math.sin(f * 1.6) * 10 * (f % 10 < 6 ? 1 : 0.2);
  const ring = spring({frame: f % 10, fps, config: {damping: 8}});
  return (
    <div style={{position: 'absolute', left: 110, right: 110, top: 760, background: C.card, borderRadius: 48, boxShadow: SHADOW, padding: '56px 50px', transform: `rotate(${shake / 10}deg) translateX(${shake}px)`, textAlign: 'center'}}>
      <div style={{width: 170, height: 170, borderRadius: 9999, background: C.primary100, color: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', fontSize: 72, fontWeight: 800}}>LF</div>
      <div style={{fontSize: 58, fontWeight: 700, marginTop: 30}}>Lucía Fernández</div>
      <div style={{fontSize: 38, color: C.muted, marginTop: 8}}>llamando…</div>
      <div style={{display: 'flex', justifyContent: 'center', marginTop: 44}}>
        <div style={{width: 130, height: 130, borderRadius: 9999, background: C.success, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.9 + ring * 0.1})`}}>
          <PhoneIcon size={64} color="#fff" />
        </div>
      </div>
      <div style={{position: 'absolute', right: -30, top: -40, background: C.destructive, color: '#fff', fontWeight: 900, fontSize: 64, minWidth: 120, height: 120, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 22px', transform: `scale(${1 + 0.15 * (1 - ring)})`}}>{n}</div>
      <div style={{marginTop: 40, fontSize: 46, fontWeight: 700, color: C.fg, background: C.mutedBg, borderRadius: 28, padding: '22px 30px'}}>“¿Ya está mi equipo?”</div>
    </div>
  );
};

const Missed: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const items = [
    ['Lucía', '¿Ya está mi equipo?'],
    ['Martín', '¿Cuánto me sale al final?'],
    ['Sofía', '¿Lo paso a buscar hoy?'],
    ['Lucía', '¿Hola? ¿Ya está?'],
  ];
  return (
    <div style={{position: 'absolute', left: 90, right: 90, top: 640}}>
      {items.map(([who, msg], i) => {
        const s = spring({frame: f - 6 - i * 10, fps, config: {damping: 16}});
        return (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 28, background: C.card, borderRadius: 36, boxShadow: SHADOW, padding: '30px 36px', marginBottom: 28, opacity: s, transform: `translateX(${(1 - s) * 200}px)`}}>
            <div style={{width: 92, height: 92, borderRadius: 9999, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>
              <PhoneMissed size={46} color={C.destructiveText} />
            </div>
            <div>
              <div style={{fontSize: 40, fontWeight: 700}}>{who} · llamada perdida</div>
              <div style={{fontSize: 36, color: C.muted, marginTop: 4}}>{msg}</div>
            </div>
          </div>
        );
      })}
      <div style={{display: 'flex', justifyContent: 'center', marginTop: 30, opacity: spring({frame: f - 50, fps})}}>
        <Pill bg={C.fg} color="#fff" size={40}><Wrench size={40} /> Y vos, con el equipo abierto</Pill>
      </div>
    </div>
  );
};

const Estado: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const flip = spring({frame: f - 68, fps, config: {damping: 12, stiffness: 170}});
  return (
    <>
      <Title text="Con STApp cambiás el estado de la orden *en un toque*" top={190} size={74} />
      <Phone src="screens/ordenes.png" top={500} keys={[{f: 0, z: 1, x: 584, y: 1265}, {f: 15, z: 1, x: 584, y: 1265}, {f: 50, z: 2.4, x: 883, y: 1120}, {f: 115, z: 2.4, x: 883, y: 1120}, {f: 145, z: 1.12, x: 584, y: 1250}]}>
        {(ts) => {
          const a = ts(694, 1023);
          return (
            <>
              {f >= 68 && (
                <div style={{position: 'absolute', left: a.x - 4, top: a.y - 4, height: 64 * a.k + 8, width: 378 * a.k + 8, borderRadius: 9999, background: C.estadoReparado, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 * a.k, fontWeight: 700, fontSize: 34 * a.k, transform: `scale(${0.6 + 0.4 * flip})`, opacity: flip}}>
                  <CheckCircle2 size={36 * a.k} /> Reparado
                </div>
              )}
              <Highlight toScreen={ts} x={50} y={975} w={1072} h={655} from={150} label="Orden CEL008 · lista" />
            </>
          );
        }}
      </Phone>
    </>
  );
};

const WhatsApp: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const typing = f > 20 && f < 50;
  const msg = spring({frame: f - 50, fps, config: {damping: 15}});
  const sent = spring({frame: f - 85, fps, config: {damping: 15}});
  return (
    <>
      <Title text="…y el aviso le llega *solo* por WhatsApp" top={190} size={74} />
      <div style={{position: 'absolute', left: 80, right: 80, top: 560, background: C.card, borderRadius: 48, boxShadow: SHADOW, overflow: 'hidden'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 24, padding: '30px 36px', borderBottom: `2px solid ${C.border}`}}>
          <div style={{width: 84, height: 84, borderRadius: 9999, background: C.success100, display: 'flex', alignItems: 'center', justifyContent: 'center'}}><MessageCircle size={44} color={C.success} /></div>
          <div>
            <div style={{fontSize: 40, fontWeight: 700}}>Lucía Fernández</div>
            <div style={{fontSize: 30, color: C.muted}}>WhatsApp</div>
          </div>
        </div>
        <div style={{background: C.mutedBg, padding: '44px 36px', minHeight: 520}}>
          {typing && (
            <div style={{display: 'inline-flex', gap: 12, background: C.card, padding: '26px 32px', borderRadius: 30}}>
              {[0, 1, 2].map((i) => <div key={i} style={{width: 18, height: 18, borderRadius: 9, background: C.muted, opacity: 0.4 + 0.6 * Math.abs(Math.sin((f + i * 5) / 6))}} />)}
            </div>
          )}
          {f >= 50 && (
            <div style={{background: C.success50, border: `2px solid ${C.success100}`, borderRadius: 34, borderTopLeftRadius: 8, padding: '30px 34px', fontSize: 40, lineHeight: 1.35, opacity: msg, transform: `translateY(${(1 - msg) * 40}px) scale(${0.95 + 0.05 * msg})`, transformOrigin: 'top left'}}>
              ¡Hola! Tu orden #CEL008 (Samsung A54) cambió a: <b>Reparado</b>.<br /><br />¡Tu equipo está listo para retirar!<br /><br />Gracias por confiar en Taller Demo
              <div style={{textAlign: 'right', fontSize: 28, color: C.muted, marginTop: 10, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8}}>10:42 <CheckCheck size={32} color={C.primary} /></div>
            </div>
          )}
        </div>
      </div>
      <div style={{position: 'absolute', top: 1500, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: sent, transform: `scale(${0.8 + 0.2 * sent})`}}>
        <Pill bg={C.success} color="#fff" size={42}><CheckCircle2 size={44} /> Enviado automáticamente</Pill>
      </div>
    </>
  );
};

const Punch: React.FC = () => (
  <AbsoluteFill style={{justifyContent: 'center'}}>
    <Title text="Cero llamadas. *Más tiempo* para reparar." top={700} size={104} />
  </AbsoluteFill>
);

export const V1: React.FC = () => {
  const parts = [
    <><Title text="Cuando el cliente te llama *por décima vez*" top={200} size={84} /><Call /></>,
    <><Title text="Y no es *solo* Lucía…" top={240} size={90} /><Missed /></>,
    <Estado />,
    <WhatsApp />,
    <Punch />,
  ];
  let from = 0;
  return (
    <Bg>
      {parts.map((p, i) => {
        const d = V1_SCENES[i];
        const el = <Sequence key={i} from={from} durationInFrames={d}><Scene dur={d}>{p}</Scene></Sequence>;
        from += d;
        return el;
      })}
      <Sequence from={from} durationInFrames={V1_SCENES[5]}><CTA /></Sequence>
    </Bg>
  );
};
