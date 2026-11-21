import React from 'react';
import {Composition} from 'remotion';
import {V1, V1_DUR, V1Voz, V1VOZ_DUR} from './V1';
import {V2, V2_DUR, V2Voz, V2VOZ_DUR} from './V2';
import {V3, V3_DUR} from './V3';

const common = {fps: 30, width: 1080, height: 1920};
export const Root: React.FC = () => (
  <>
    <Composition id="TikTok1-ClienteLlama" component={V1} durationInFrames={V1_DUR} {...common} />
    <Composition id="TikTok2-LibretaVsSTApp" component={V2} durationInFrames={V2_DUR} {...common} />
    <Composition id="TikTok3-TallerEnElCelular" component={V3} durationInFrames={V3_DUR} {...common} />
    <Composition id="TikTok1-ClienteLlama-Voz" component={V1Voz} durationInFrames={V1VOZ_DUR} {...common} />
    <Composition id="TikTok2-LibretaVsSTApp-Voz" component={V2Voz} durationInFrames={V2VOZ_DUR} {...common} />
  </>
);
