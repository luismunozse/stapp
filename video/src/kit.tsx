import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/inter/900.css';
import {C, EASE_IN_OUT, EASE_OUT, FONT, SHADOW} from './brand';

export const easeInOut = Easing.bezier(...EASE_IN_OUT);
export const easeOut = Easing.bezier(...EASE_OUT);

export const Bg: React.FC<{children?: React.ReactNode}> = ({children}) => (
  <AbsoluteFill style={{background: C.bg, fontFamily: FONT, color: C.fg}}>
    <div style={{position: 'absolute', width: 1300, height: 1300, borderRadius: 9999, left: -420, top: -560, background: `radial-gradient(circle, ${C.primary100} 0%, transparent 65%)`}} />
    <div style={{position: 'absolute', width: 1100, height: 1100, borderRadius: 9999, right: -520, bottom: -380, background: `radial-gradient(circle, ${C.primary50} 0%, transparent 65%)`}} />
    {children}
  </AbsoluteFill>
);

// Escena con la transición única del video: entra deslizando 12 frames, sale con fundido.
export const Scene: React.FC<{dur: number; children: React.ReactNode; noOut?: boolean}> = ({dur, children, noOut}) => {
  const f = useCurrentFrame();
  const inP = interpolate(f, [0, 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut});
  const out = noOut ? 1 : interpolate(f, [dur - 8, dur], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{opacity: Math.min(inP, out), transform: `translateY(${(1 - inP) * 60}px)`}}>{children}</AbsoluteFill>;
};

// Título grande. Las palabras entre *asteriscos* van en el primario de la marca.
export const Title: React.FC<{text: string; top?: number; size?: number; delay?: number; align?: 'center' | 'left'; color?: string}> = ({text, top = 200, size = 84, delay = 0, align = 'center', color = C.fg}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const words = text.split(' ');
  return (
    <div style={{position: 'absolute', top, left: 70, right: 70, textAlign: align, fontSize: size, fontWeight: 800, lineHeight: 1.08, letterSpacing: -2, color}}>
      {words.map((w, i) => {
        const hl = words.slice(0, i + 1).join(' ').split('*').length % 2 === 0 || w.endsWith('*');
        const clean = w.replace(/\*/g, '');
        const s = spring({frame: f - delay - i * 2, fps, config: {damping: 18, stiffness: 180}});
        return (
          <span key={i} style={{display: 'inline-block', opacity: s, transform: `translateY(${(1 - s) * 30}px)`, color: hl ? C.primary : undefined, marginRight: '0.24em'}}>{clean}</span>
        );
      })}
    </div>
  );
};

export const Pill: React.FC<{children: React.ReactNode; bg?: string; color?: string; size?: number; style?: React.CSSProperties}> = ({children, bg = C.primary, color = C.primaryFg, size = 40, style}) => (
  <div style={{display: 'inline-flex', alignItems: 'center', gap: 14, background: bg, color, fontWeight: 700, fontSize: size, padding: `${size * 0.35}px ${size * 0.7}px`, borderRadius: 9999, ...style}}>{children}</div>
);

// Captura de celular dentro de un marco, con cámara que hace zoom y paneo.
// keys: puntos de cámara {f: frame, z: zoom, x, y: foco en px de la captura}.
export type Cam = {f: number; z: number; x: number; y: number};
export const SHOT_W = 1169;
export const SHOT_H = 2531;
export const Phone: React.FC<{src: string; keys: Cam[]; top?: number; width?: number; children?: (toScreen: (x: number, y: number) => {x: number; y: number; k: number}) => React.ReactNode}> = ({src, keys, top = 560, width = 620, children}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame: f, fps, config: {damping: 20, stiffness: 120}});
  const s0 = width / SHOT_W;
  const winH = SHOT_H * s0;
  const fr = keys.map((k) => k.f);
  const v = (p: 'z' | 'x' | 'y') => keys.length === 1 ? keys[0][p] : interpolate(f, fr, keys.map((k) => k[p]), {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOut});
  const z = v('z');
  const k = s0 * z;
  let tx = width / 2 - v('x') * k;
  let ty = winH / 2 - v('y') * k;
  tx = Math.min(0, Math.max(width - SHOT_W * k, tx));
  ty = Math.min(0, Math.max(winH - SHOT_H * k, ty));
  const toScreen = (x: number, y: number) => ({x: tx + x * k, y: ty + y * k, k});
  const bez = 20;
  return (
    <div style={{position: 'absolute', left: (1080 - width) / 2 - bez, top: top + (1 - enter) * 300, width: width + bez * 2, height: winH + bez * 2, borderRadius: 86, background: C.fg, padding: bez, boxShadow: SHADOW, opacity: enter}}>
      <div style={{position: 'relative', width, height: winH, borderRadius: 66, overflow: 'hidden', background: C.card}}>
        <Img src={staticFile(src)} style={{position: 'absolute', left: 0, top: 0, width: SHOT_W, height: SHOT_H, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${k})`}} />
        {children?.(toScreen)}
      </div>
    </div>
  );
};

// Recuadro de resaltado en coordenadas de la captura, con etiqueta.
export const Highlight: React.FC<{toScreen: (x: number, y: number) => {x: number; y: number; k: number}; x: number; y: number; w: number; h: number; from: number; label?: string}> = ({toScreen, x, y, w, h, from, label}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f - from, fps, config: {damping: 14, stiffness: 160}});
  if (f < from) return null;
  const a = toScreen(x, y);
  const pad = 10;
  return (
    <div style={{position: 'absolute', left: a.x - pad, top: a.y - pad, width: w * a.k + pad * 2, height: h * a.k + pad * 2, border: `6px solid ${C.primary}`, borderRadius: 22, opacity: s, transform: `scale(${1.15 - 0.15 * s})`, boxShadow: `0 0 0 9999px rgb(15 23 42 / ${0.28 * s})`}}>
      {label && (
        <div style={{position: 'absolute', left: -6, top: -66, background: C.primary, color: C.primaryFg, fontWeight: 700, fontSize: 32, padding: '8px 18px', borderRadius: 14, whiteSpace: 'nowrap'}}>{label}</div>
      )}
    </div>
  );
};

export const Logo: React.FC<{size: number}> = ({size}) => <Img src={staticFile('logo.svg')} style={{width: size, height: size}} />;

// Cierre: mismo para los tres videos.
export const CTA: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const a = spring({frame: f, fps, config: {damping: 14}});
  const b = spring({frame: f - 10, fps, config: {damping: 16}});
  const c = spring({frame: f - 22, fps, config: {damping: 16}});
  const d = spring({frame: f - 34, fps, config: {damping: 16}});
  const pulse = 1 + 0.03 * Math.sin((f / fps) * Math.PI * 2);
  return (
    <Bg>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', paddingBottom: 180}}>
        <div style={{transform: `scale(${a})`}}><Logo size={250} /></div>
        <div style={{fontSize: 120, fontWeight: 900, letterSpacing: -4, marginTop: 10, opacity: a}}>STApp</div>
        <div style={{fontSize: 46, fontWeight: 500, color: C.muted, marginTop: 6, opacity: b, textAlign: 'center'}}>El sistema para tu taller de reparación</div>
        <div style={{marginTop: 70, opacity: c, transform: `translateY(${(1 - c) * 40}px) scale(${pulse})`, textAlign: 'center'}}>
          <div style={{fontSize: 90, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05}}>Probalo <span style={{color: C.primary}}>30 días</span><br />gratis</div>
          <Pill bg={C.success100} color={C.successText} size={46} style={{marginTop: 34}}>Sin tarjeta de crédito</Pill>
        </div>
        <div style={{marginTop: 70, opacity: d, fontSize: 50, fontWeight: 700, color: C.primary700}}>Link en la bio · stapp.com.ar</div>
      </AbsoluteFill>
    </Bg>
  );
};
