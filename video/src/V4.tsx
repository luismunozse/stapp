import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {CheckCheck, CheckCircle2, Link2, MessageCircle, PhoneOff, ShieldCheck, Star} from 'lucide-react';
import {Highlight, Phone, Pill, Title} from './kit';
import {Chain, total, type Part} from './seq';
import {C, SHADOW} from './brand';

// Video 4 · "El link de seguimiento": por qué importa que el cliente vea su orden.
// Capturas reales de /seguimiento/[token] (scripts/capturar-seguimiento.cjs), orden ficticia.
const W = 1170;
const REP = {src: 'screens/seguimiento-en_reparacion.png', shotW: W, shotH: 5019};
const LISTO = {src: 'screens/seguimiento-reparado.png', shotW: W, shotH: 5643};
const TOP = {z: 1, x: 585, y: 1266};

const Preguntas: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const qs = ['¿Ya lo revisaron?', '¿Cuánto me sale?', '¿Para cuándo está?', '¿Ya está listo?'];
  return (
    <div style={{position: 'absolute', left: 90, right: 90, top: 640}}>
      {qs.map((q, i) => {
        const s = spring({frame: f - 10 - i * 12, fps, config: {damping: 14}});
        const right = i % 2 === 1;
        return (
          <div key={i} style={{display: 'flex', justifyContent: right ? 'flex-end' : 'flex-start', marginBottom: 34}}>
            <div style={{background: C.card, boxShadow: SHADOW, borderRadius: 40, [right ? 'borderBottomRightRadius' : 'borderBottomLeftRadius']: 10, padding: '30px 42px', fontSize: 52, fontWeight: 700, opacity: s, transform: `scale(${0.7 + 0.3 * s})`, transformOrigin: right ? 'right bottom' : 'left bottom'}}>{q}</div>
          </div>
        );
      })}
    </div>
  );
};

const Link: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const msg = spring({frame: f - 14, fps, config: {damping: 15}});
  const pills = ['Sin descargar nada', 'Sin usuario', 'Sin contraseña'];
  return (
    <>
      <Title text="Con STApp recibe *su link de seguimiento*" top={190} size={80} />
      <div style={{position: 'absolute', left: 80, right: 80, top: 560, background: C.card, borderRadius: 48, boxShadow: SHADOW, overflow: 'hidden'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 24, padding: '28px 36px', borderBottom: `2px solid ${C.border}`}}>
          <div style={{width: 80, height: 80, borderRadius: 9999, background: C.success100, display: 'flex', alignItems: 'center', justifyContent: 'center'}}><MessageCircle size={42} color={C.success} /></div>
          <div><div style={{fontSize: 38, fontWeight: 700}}>Taller Demo</div><div style={{fontSize: 28, color: C.muted}}>WhatsApp</div></div>
        </div>
        <div style={{background: C.mutedBg, padding: '40px 36px'}}>
          <div style={{background: C.success50, border: `2px solid ${C.success100}`, borderRadius: 34, borderTopLeftRadius: 8, padding: '28px 32px', fontSize: 38, lineHeight: 1.35, opacity: msg, transform: `translateY(${(1 - msg) * 40}px)`}}>
            Hola Lucía, recibimos tu Galaxy A54 en Taller Demo.<br /><br />Podés seguir el estado acá:<br />
            <span style={{color: C.primary700, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10}}><Link2 size={36} /> tallerdemo.stapp.com.ar/seguimiento/…</span>
            <div style={{textAlign: 'right', fontSize: 26, color: C.muted, marginTop: 8, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8}}>10:02 <CheckCheck size={30} color={C.primary} /></div>
          </div>
        </div>
      </div>
      <div style={{position: 'absolute', top: 1300, left: 60, right: 60, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 22}}>
        {pills.map((p, i) => {
          const s = spring({frame: f - 45 - i * 8, fps, config: {damping: 14}});
          return <div key={p} style={{opacity: s, transform: `scale(${0.7 + 0.3 * s})`}}><Pill bg={C.primary50} color={C.primary700} size={40}><CheckCircle2 size={40} /> {p}</Pill></div>;
        })}
      </div>
    </>
  );
};

const Beneficios: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const items: [React.ReactNode, string][] = [
    [<PhoneOff size={56} color={C.primary} />, 'Menos llamadas preguntando'],
    [<ShieldCheck size={56} color={C.primary} />, 'Más confianza: ve todo el proceso'],
    [<Star size={56} color={C.primary} />, 'Imagen de taller profesional'],
  ];
  return (
    <>
      <Title text="¿Por qué *importa tanto?*" top={260} size={96} />
      <div style={{position: 'absolute', left: 90, right: 90, top: 600}}>
        {items.map(([icon, t], i) => {
          const s = spring({frame: f - 12 - i * 12, fps, config: {damping: 15}});
          return (
            <div key={i} style={{display: 'flex', alignItems: 'center', gap: 32, background: C.card, borderRadius: 40, boxShadow: SHADOW, padding: '38px 40px', marginBottom: 34, opacity: s, transform: `translateX(${(1 - s) * -160}px)`}}>
              <div style={{width: 110, height: 110, borderRadius: 30, background: C.primary50, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>{icon}</div>
              <div style={{fontSize: 50, fontWeight: 700, lineHeight: 1.15}}>{t}</div>
            </div>
          );
        })}
      </div>
    </>
  );
};

const scenes: Part[] = [
  [100, <><Title text="Tu cliente quiere saber *cómo va su reparación*" top={200} size={84} /><Preguntas /></>],
  [130, <Link />],
  [150, <>
    <Title text="Ve el estado de su equipo, *siempre al día*" top={190} size={78} />
    <Phone {...REP} top={500} keys={[{f: 0, ...TOP}, {f: 20, ...TOP}, {f: 50, z: 1.12, x: 585, y: 1250}, {f: 95, z: 1.12, x: 585, y: 1250}, {f: 125, z: 1.12, x: 585, y: 1550}]}>
      {(ts) => <>
        <Highlight toScreen={ts} x={50} y={733} w={1070} h={612} from={55} label="Estado y progreso" />
      </>}
    </Phone>
  </>],
  [150, <>
    <Title text="Cada paso, *con fecha y hora*" top={220} size={84} />
    <Phone {...LISTO} top={500} keys={[{f: 0, z: 1.12, x: 585, y: 1700}, {f: 15, z: 1.12, x: 585, y: 1700}, {f: 70, z: 1.12, x: 585, y: 2500}]}>
      {(ts) => <Highlight toScreen={ts} x={50} y={1853} w={1070} h={1368} from={75} label="Historial de la reparación" />}
    </Phone>
  </>],
  [140, <>
    <Title text="Y cuando está listo, *coordina el retiro*" top={190} size={80} />
    <Phone {...LISTO} top={500} keys={[{f: 0, ...TOP}, {f: 20, ...TOP}, {f: 55, z: 1.12, x: 585, y: 1250}]}>
      {(ts) => <Highlight toScreen={ts} x={50} y={1262} w={1070} h={216} from={60} label="Un toque y te escribe" />}
    </Phone>
  </>],
  [120, <Beneficios />],
];
export const V4_DUR = total(scenes);
export const V4: React.FC = () => <Chain scenes={scenes} />;
