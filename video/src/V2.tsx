import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {Highlight, Phone, Pill, Title} from './kit';
import {Chain, total} from './seq';
import {C, SHADOW} from './brand';

// Video 2 · "De la libreta a STApp" (antes y después)
const notas = [
  'Juan · Samsung · ¿dejó seña?',
  'Moto G pantalla — $ ¿?',
  'Notebook HP → ¿la retiraron?',
  'Llamar a Sofi (¿o era Sonia?)',
  'Repuesto batería: pedir ¿cuántas?',
];
const Libreta: React.FC<{crumple?: boolean}> = ({crumple}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const c = crumple ? interpolate(f, [10, 40], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : 0;
  return (
    <div style={{position: 'absolute', left: 100, right: 100, top: 620, background: C.card, borderRadius: 18, boxShadow: SHADOW, padding: '50px 46px 50px 96px', transform: `rotate(${-2 - c * 30}deg) scale(${1 - c * 0.7}) translateY(${c * 600}px)`, opacity: 1 - c,
      backgroundImage: `linear-gradient(90deg, transparent 70px, ${C.destructive}55 70px, ${C.destructive}55 73px, transparent 73px), repeating-linear-gradient(180deg, transparent 0 87px, ${C.primary100} 87px 90px)`}}>
      {notas.map((n, i) => {
        const s = crumple ? 1 : spring({frame: f - 8 - i * 12, fps, config: {damping: 20}});
        return <div key={i} style={{fontSize: 44, fontWeight: 500, height: 90, lineHeight: '90px', color: C.fg, opacity: s, transform: `rotate(${(i % 2 ? 1 : -1) * 0.8}deg)`, whiteSpace: 'nowrap', clipPath: `inset(0 ${(1 - s) * 100}% 0 0)`}}>{n}</div>;
      })}
      {!crumple && (
        <div style={{position: 'absolute', right: -10, bottom: -110, fontSize: 120, fontWeight: 900, color: C.destructiveText, transform: 'rotate(12deg)', opacity: spring({frame: f - 75, fps})}}>???</div>
      )}
    </div>
  );
};

const Antes: React.FC = () => (
  <>
    <Libreta crumple />
    <AbsoluteFill style={{justifyContent: 'center'}}>
      <Title text="Así se te *pierde plata* todos los meses." top={720} size={100} delay={14} />
    </AbsoluteFill>
  </>
);

const scenes: [number, React.ReactNode][] = [
  [120, <><Title text="¿Tu taller todavía *funciona así?*" top={220} size={92} /><Libreta /></>],
  [66, <Antes />],
  [150, <>
    <div style={{position: 'absolute', top: 150, width: '100%', textAlign: 'center'}}><Pill bg={C.success100} color={C.successText} size={36}>AHORA, CON STAPP</Pill></div>
    <Title text="Sabés *cuánto ganaste* este mes" top={250} size={80} delay={4} />
    <Phone src="screens/dashboard.png" top={500} keys={[{f: 0, z: 1, x: 584, y: 1265}, {f: 25, z: 1, x: 584, y: 1265}, {f: 65, z: 1.7, x: 863, y: 900}]}>
      {(ts) => <Highlight toScreen={ts} x={605} y={795} w={517} h={300} from={75} label="Ingresos del mes" />}
    </Phone>
  </>],
  [130, <>
    <Title text="Cada equipo con su estado. *Nada se pierde.*" top={190} size={76} />
    <Phone src="screens/ordenes.png" top={500} keys={[{f: 0, z: 1, x: 584, y: 1265}, {f: 20, z: 1, x: 584, y: 1265}, {f: 55, z: 1.12, x: 584, y: 1550}]}>
      {(ts) => <Highlight toScreen={ts} x={50} y={975} w={1072} h={655} from={60} label="Lucía · Samsung A54" />}
    </Phone>
  </>],
  [124, <>
    <Title text="Y el stock, *bajo control*" top={220} size={84} />
    <Phone src="screens/inventario.png" top={500} keys={[{f: 0, z: 1, x: 584, y: 1265}, {f: 20, z: 1, x: 584, y: 1265}, {f: 55, z: 1.15, x: 584, y: 1600}]}>
      {(ts) => <Highlight toScreen={ts} x={50} y={1359} w={1072} h={605} from={60} label="Stock y precio al día" />}
    </Phone>
  </>],
];
export const V2_DUR = total(scenes);
export const V2: React.FC = () => <Chain scenes={scenes} />;
