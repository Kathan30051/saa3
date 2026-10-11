import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import Lenis from 'lenis';
import { letter, scenes } from './content.js';
import 'lenis/dist/lenis.css';
import './styles.css';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const easeOut = value => 1 - Math.pow(1 - clamp(value), 4);
const cubicBezier = (x1, y1, x2, y2) => value => {
  const x = clamp(value);
  let low = 0, high = 1, t = x;
  for (let i = 0; i < 12; i++) {
    t = (low + high) / 2;
    const curveX = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3;
    if (curveX < x) low = t; else high = t;
  }
  return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3;
};
const entranceEase = cubicBezier(.22, 1, .36, 1);
const exitEase = cubicBezier(.64, 0, .78, 0);
const SCENE_TRACK_VH = 300;
const SCENE_OVERLAP_VH = 130;
const SCENE_STRIDE_VH = SCENE_TRACK_VH - SCENE_OVERLAP_VH;
const STICKY_SCROLL_VH = SCENE_TRACK_VH - 100;

const START_SECONDS = 0;
const AUDIO_VOLUME = { hero: .2, distance: .2, recognition: .2, mirror: .12, together: .2, letter: .2, proposal: .5, celebration: .6 };

function AudioExperience({ pageProgress, accepted }) {
  const audioRef = useRef(null), contextRef = useRef(null), gainRef = useRef(null), sourceRef = useRef(null);
  const soundOnRef = useRef(false), startedRef = useRef(false), pauseTimerRef = useRef(0), closingTimersRef = useRef([]), fallbackTimerRef = useRef(0);
  const fallbackTargetRef = useRef(AUDIO_VOLUME.hero), fallbackTauRef = useRef(.5);
  const [soundOn, setSoundOn] = useState(false), [available, setAvailable] = useState(true);

  const rampTo = (target, seconds = 1.5) => {
    const gain = gainRef.current, context = contextRef.current;
    if (gain && context) {
      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(target, now + seconds);
    } else if (audioRef.current) {
      fallbackTargetRef.current = clamp(target);
      fallbackTauRef.current = Math.max(.12, seconds / 3);
      if (!fallbackTimerRef.current) {
        fallbackTimerRef.current = window.setInterval(() => {
          const audio = audioRef.current;
          if (!audio || gainRef.current) {
            window.clearInterval(fallbackTimerRef.current);
            fallbackTimerRef.current = 0;
            return;
          }
          const currentTarget = fallbackTargetRef.current;
          const alpha = 1 - Math.exp(-.05 / fallbackTauRef.current);
          const next = audio.volume + (currentTarget - audio.volume) * alpha;
          if (Math.abs(currentTarget - next) < .002) {
            audio.volume = currentTarget;
            window.clearInterval(fallbackTimerRef.current);
            fallbackTimerRef.current = 0;
          } else audio.volume = next;
        }, 50);
      }
    }
  };

  useEffect(() => () => window.clearInterval(fallbackTimerRef.current), []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || startedRef.current) return;
    audio.currentTime = START_SECONDS;
    audio.volume = AUDIO_VOLUME.hero;
    fallbackTargetRef.current = AUDIO_VOLUME.hero;
    startedRef.current = true;
    audio.play().then(() => {
      soundOnRef.current = true;
      setSoundOn(true);
    }).catch(() => {
      // Audible autoplay can be blocked until the visitor interacts with the page.
    });
  }, []);

  useEffect(() => {
    const unsubscribe = pageProgress.on('change', progress => {
      if (!soundOnRef.current || accepted) return;
      const total = 200 + 170 * 6;
      const centers = [100, 270, 440, 610, 780, 950, 1120].map(value => value / total);
      const levels = [AUDIO_VOLUME.hero, AUDIO_VOLUME.distance, AUDIO_VOLUME.recognition, AUDIO_VOLUME.mirror, AUDIO_VOLUME.together, AUDIO_VOLUME.letter, AUDIO_VOLUME.proposal];
      let volume = levels[0];
      for (let i = 0; i < centers.length - 1; i++) {
        if (progress <= centers[i + 1]) {
          const t = clamp((progress - centers[i]) / (centers[i + 1] - centers[i]));
          volume = levels[i] + (levels[i + 1] - levels[i]) * t;
          break;
        }
        volume = levels[i + 1];
      }
      rampTo(volume, 1.5);
    });
    return unsubscribe;
  }, [pageProgress, accepted]);

  useEffect(() => {
    if (!accepted) return;
    if (soundOnRef.current) rampTo(AUDIO_VOLUME.celebration, 1.5);
    const fadeTimer = window.setTimeout(() => { if (soundOnRef.current) rampTo(0, 8); }, 1500);
    const pauseTimer = window.setTimeout(() => audioRef.current?.pause(), 9500);
    closingTimersRef.current = [fadeTimer, pauseTimer];
    return () => closingTimersRef.current.forEach(window.clearTimeout);
  }, [accepted]);

  useEffect(() => {
    const handleVisibility = () => {
      const audio = audioRef.current;
      if (document.hidden) audio?.pause();
      else if (soundOnRef.current && audio && !audio.ended) audio.play().catch(() => setAvailable(false));
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const toggleSound = async () => {
    const audio = audioRef.current;
    if (!audio || !available) return;
    window.clearTimeout(pauseTimerRef.current);
    if (soundOnRef.current) {
      soundOnRef.current = false;
      setSoundOn(false);
      rampTo(0, 1);
      pauseTimerRef.current = window.setTimeout(() => audio.pause(), 1000);
      return;
    }
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass && !contextRef.current) {
        window.clearInterval(fallbackTimerRef.current);
        fallbackTimerRef.current = 0;
        const context = new AudioContextClass();
        const source = context.createMediaElementSource(audio);
        const gain = context.createGain();
        gain.gain.value = 0;
        audio.volume = 1;
        source.connect(gain).connect(context.destination);
        contextRef.current = context;
        sourceRef.current = source;
        gainRef.current = gain;
      }
      if (contextRef.current) await contextRef.current.resume();
      if (!startedRef.current) { audio.currentTime = START_SECONDS; startedRef.current = true; }
      soundOnRef.current = true;
      setSoundOn(true);
      await audio.play();
      rampTo(accepted ? AUDIO_VOLUME.celebration : AUDIO_VOLUME.hero, 1.5);
    } catch {
      soundOnRef.current = false;
      setSoundOn(false);
      setAvailable(false);
    }
  };

  if (!available) return null;
  return <>
    <audio ref={audioRef} preload="none" src="/audio/The%20Neighbourhood%20-%20Sweater%20Weather%20(slowed%20+%20reverb)%20-%20Ghosted.mp3" onError={() => setAvailable(false)} />
    <button className="sound-toggle" type="button" onClick={toggleSound} aria-label={soundOn ? 'Turn sound off' : 'Turn sound on'} aria-pressed={soundOn}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d={soundOn ? 'M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11' : 'M16 9l5 6m0-6-5 6'}/></svg>
    </button>
  </>;
}

function ContinuousBackground({ pageProgress, titleRef, sceneCount, mirrorIndex, proposalIndex, celebrationRef, celebrating }) {
  const canvasRef = useRef(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !ctx) return;
    const motionReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hasHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
    let width = 0, height = 0, dpr = 1, raf = 0, time = 0, resizeTimer = 0, heroVisible = true;
    const pointer = { x: innerWidth * .62, y: innerHeight * .45, active: false };
    const lead = { x: pointer.x, y: pointer.y, opacity: hasHover ? .2 : .32 };
    const companion = { x: innerWidth * .17, y: innerHeight * .53 };
    const titleLines = titleRef.current?.querySelectorAll('.title-line') || [];
    const lenis = motionReduced ? null : new Lenis({ lerp: .08, wheelMultiplier: 1, touchMultiplier: 1.2, syncTouch: true, autoRaf: false, anchors: true, respectReducedMotion: true });
    const totalScroll = 200 + 170 * (sceneCount - 1);
    const sceneCenter = index => (index * 170 + 100) / totalScroll;
    const dust = Array.from({ length: 40 }, () => ({
      x: Math.random() * innerWidth, y: Math.random() * innerHeight,
      phase: Math.random() * Math.PI * 2, speed: .13 + Math.random() * .2,
      ampX: 2 + Math.random() * 8, ampY: 2 + Math.random() * 9,
      radius: .5 + Math.random(), alpha: .08 + Math.random() * .13,
      peach: Math.random() < .38, pushX: 0, pushY: 0
    }));
    const resize = () => {
      width = innerWidth; height = innerHeight; dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = () => {
      const p = pageProgress.get();
      const mirror = clamp(1 - Math.abs(p - sceneCenter(mirrorIndex)) / (105 / totalScroll));
      const mirrorStart = mirrorIndex * 170 / totalScroll;
      const mirrorEnd = (mirrorIndex * 170 + STICKY_SCROLL_VH + 20) / totalScroll;
      const mirrorLightsHidden = clamp(Math.min((p - mirrorStart) / .025, (mirrorEnd - p) / .025));
      const proposal = clamp(1 - Math.abs(p - sceneCenter(proposalIndex)) / (110 / totalScroll));
      const proposalScene = clamp((p - proposalIndex * 170 / totalScroll) / .045);
      if (celebrationRef.current) {
        lead.x += (width * .5 - lead.x) * .035; lead.y += (height * .44 - lead.y) * .035;
        companion.x += (width * .5 - companion.x) * .035; companion.y += (height * .44 - companion.y) * .035;
      }
      const recognitionStart = 2 * 170 / totalScroll;
      const recognitionEnd = (2 * 170 + STICKY_SCROLL_VH) / totalScroll;
      const recognition = clamp(Math.min((p - recognitionStart) / .04, (recognitionEnd - p) / .04));
      const letterStart = 5 * 170 / totalScroll;
      const letterEnd = (5 * 170 + STICKY_SCROLL_VH) / totalScroll;
      const letterScene = clamp(Math.min((p - letterStart) / .04, (letterEnd - p) / .04));
      ctx.clearRect(0, 0, width, height);
      const glowX = width * (.5 + Math.sin(time * .07) * .035);
      const glowY = height * (.39 + p * .12 + Math.sin(time * .045) * .02);
      const glow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, Math.max(width, height) * .78);
      const warmth = .14 + p * .08 - mirror * .08 + proposal * .1;
      glow.addColorStop(0, `rgba(242,184,160,${clamp(warmth, .04, .34)})`);
      glow.addColorStop(.48, `rgba(234,178,156,${clamp(warmth * .44, .02, .17)})`);
      glow.addColorStop(1, 'rgba(234,178,156,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);

      if (!motionReduced && hasHover) {
        lead.x += (pointer.x - lead.x) * .08; lead.y += (pointer.y - lead.y) * .08;
        lead.opacity += ((pointer.active ? .45 : .2) - lead.opacity) * .045;
        const dx = lead.x - companion.x, dy = lead.y - companion.y, distance = Math.hypot(dx, dy) || 1;
        const gap = 120 * (1 - p);
        let targetX = lead.x - dx / distance * gap, targetY = lead.y - dy / distance * gap;
        if (!pointer.active && p < .015) { targetX = width * .17; targetY = height * .53; }
        companion.x += (targetX - companion.x) * .01; companion.y += (targetY - companion.y) * .01;
      } else if (!motionReduced) {
        lead.opacity += (.32 - lead.opacity) * .02;
        const targetX = width * (.62 - .12 * p) + Math.sin(time * .12) * 12;
        const targetY = height * (.45 + .025 * Math.sin(time * .16));
        lead.x += (targetX - lead.x) * .003; lead.y += (targetY - lead.y) * .003;
        const gap = Math.min(150, width * .36) * (1 - p);
        companion.x += (lead.x - gap - companion.x) * .003;
        companion.y += (lead.y - companion.y) * .003;
      }
      if (!motionReduced && hasHover && titleLines.length > 1) {
        const nx = (lead.x / Math.max(width, 1) - .5) * 2, ny = (lead.y / Math.max(height, 1) - .5) * 2;
        titleLines[0].style.translate = `${-nx * 6}px ${-ny * 6}px`;
        titleLines[1].style.translate = `${nx * 12}px ${ny * 12}px`;
      }
      const leadOpacity = lead.opacity * (1 - mirrorLightsHidden) * (1 - recognition) * (celebrationRef.current ? 1 : (1 - proposalScene));
      const cursorGlow = ctx.createRadialGradient(lead.x, lead.y, 0, lead.x, lead.y, 110);
      cursorGlow.addColorStop(0, `rgba(242,184,160,${leadOpacity})`);
      cursorGlow.addColorStop(.42, `rgba(242,184,160,${leadOpacity * .38})`);
      cursorGlow.addColorStop(1, 'rgba(242,184,160,0)');
      ctx.fillStyle = cursorGlow; ctx.fillRect(lead.x - 110, lead.y - 110, 220, 220);
      const companionVisibility = (1 - recognition) * (1 - letterScene * .98) * (celebrationRef.current ? 1 : (1 - proposalScene));
      const lightAlpha = .3 * (1 - mirrorLightsHidden) * companionVisibility;
      const halo = ctx.createRadialGradient(companion.x, companion.y, 0, companion.x, companion.y, 70);
      halo.addColorStop(0, `rgba(242,184,160,${lightAlpha})`);
      halo.addColorStop(.25, `rgba(242,184,160,${lightAlpha * .46})`);
      halo.addColorStop(1, 'rgba(242,184,160,0)');
      ctx.fillStyle = halo; ctx.fillRect(companion.x - 70, companion.y - 70, 140, 140);
      ctx.beginPath(); ctx.arc(companion.x, companion.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,239,219,${.72 * (1 - mirror * .3 + proposal * .15) * companionVisibility})`; ctx.fill();
      for (const speck of dust) {
        const driftX = Math.sin(time * speck.speed + speck.phase) * speck.ampX;
        const driftY = Math.cos(time * speck.speed * .83 + speck.phase) * speck.ampY;
        let repelX = 0, repelY = 0;
        if (!motionReduced && hasHover && pointer.active) {
          const dx = speck.x + driftX - lead.x, dy = speck.y + driftY - lead.y, distance = Math.hypot(dx, dy);
          if (distance < 140 && distance > .1) {
            const amount = Math.pow((140 - distance) / 140, 2) * 30;
            repelX = dx / distance * amount; repelY = dy / distance * amount;
          }
        }
        speck.pushX += (repelX - speck.pushX) * .035; speck.pushY += (repelY - speck.pushY) * .035;
        ctx.beginPath(); ctx.arc(speck.x + driftX + speck.pushX, speck.y + driftY + speck.pushY, speck.radius, 0, Math.PI * 2);
        const speckAlpha = speck.alpha * (1 - mirrorLightsHidden);
        ctx.fillStyle = speck.peach ? `rgba(242,184,160,${speckAlpha})` : `rgba(246,234,217,${speckAlpha})`; ctx.fill();
      }
    };
    const frame = stamp => {
      raf = 0; if (document.hidden) return;
      const dt = Math.min((stamp - (frame.last || stamp)) / 1000, .05); frame.last = stamp; time += dt;
      lenis?.raf(stamp);
      if (heroVisible) draw();
      raf = requestAnimationFrame(frame);
    };
    const move = event => { pointer.x = event.clientX; pointer.y = event.clientY; pointer.active = true; };
    const leave = () => { pointer.active = false; };
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { resize(); if (motionReduced && heroVisible) draw(); }, 120);
    };
    const visibility = () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; frame.last = 0; }
      else if (!motionReduced && !raf) raf = requestAnimationFrame(frame);
      else if (motionReduced && heroVisible) draw();
    };
    const hero = document.querySelector('.hero-composition');
    const heroObserver = hero && 'IntersectionObserver' in window ? new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting;
      if (motionReduced && heroVisible) draw();
    }, { threshold: 0 }) : null;
    if (heroObserver) heroObserver.observe(hero);
    resize();
    if (hasHover) { addEventListener('pointermove', move, { passive: true }); addEventListener('pointerleave', leave, { passive: true }); }
    addEventListener('resize', handleResize, { passive: true }); document.addEventListener('visibilitychange', visibility, { passive: true });
    if (motionReduced) draw(); else raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(resizeTimer); lenis?.destroy(); heroObserver?.disconnect();
      removeEventListener('pointermove', move); removeEventListener('pointerleave', leave);
      removeEventListener('resize', handleResize); document.removeEventListener('visibilitychange', visibility);
    };
  }, [titleRef, sceneCount, mirrorIndex, proposalIndex, reduced, pageProgress]);
  const bridgeIntensity = useTransform(pageProgress, p => {
    const total = 200 + 170 * (sceneCount - 1);
    let peak = 0;
    for (let i = 0; i < sceneCount - 1; i++) peak = Math.max(peak, clamp(1 - Math.abs(p - (i * 170 + 237) / total) / (38 / total)));
    return easeOut(peak);
  });
  const sceneStops = [0, .14, .28, .42, .56, .70, .84, 1];
  const pathEase = { ease: entranceEase };
  const orbAX = useTransform(pageProgress, sceneStops, reduced ? Array(8).fill('-30vw') : ['-42vw','-30vw','-19vw','-4vw','-9vw','-10vw','-3vw','0vw'], pathEase);
  const orbBX = useTransform(pageProgress, sceneStops, reduced ? Array(8).fill('30vw') : ['42vw','30vw','19vw','4vw','9vw','10vw','3vw','0vw'], pathEase);
  const orbAY = useTransform(pageProgress, sceneStops, reduced ? Array(8).fill('0vh') : ['-4vh','1vh','8vh','-7vh','17vh','4vh','0vh','0vh'], pathEase);
  const orbBY = useTransform(pageProgress, sceneStops, reduced ? Array(8).fill('0vh') : ['4vh','-1vh','-7vh','7vh','-16vh','-4vh','0vh','0vh'], pathEase);
  const orbOpacity = useTransform(pageProgress, p => {
    const total = 200 + 170 * (sceneCount - 1);
    const mirrorStart = mirrorIndex * 170 / total;
    const mirrorEnd = (mirrorIndex * 170 + STICKY_SCROLL_VH + 20) / total;
    const mirrorLightsHidden = clamp(Math.min((p - mirrorStart) / .025, (mirrorEnd - p) / .025));
    return (p <= 0 ? 0 : .82 + .18 * p) * (1 - mirrorLightsHidden);
  });
  const orbWillChange = useTransform(pageProgress, p => p > .01 ? 'transform, opacity' : 'auto');
  const bridgeScale = useTransform(bridgeIntensity, [0, 1], [.4, 2.2]);
  const bridgeOpacity = useTransform(bridgeIntensity, [0, 1], [0, .55]);
  const bridgeWillChange = useTransform(bridgeIntensity, value => !reduced && value > .005 ? 'transform, opacity' : 'auto');
  const warmGradeOpacity = useTransform(pageProgress, [proposalIndex * 170 / (200 + 170 * (sceneCount - 1)), (proposalIndex * 170 + 90) / (200 + 170 * (sceneCount - 1))], [0, .32], pathEase);
  const warmGradeWillChange = useTransform(pageProgress, p => !reduced && p >= proposalIndex * 170 / (200 + 170 * (sceneCount - 1)) && p <= (proposalIndex * 170 + 90) / (200 + 170 * (sceneCount - 1)) ? 'opacity' : 'auto');
  const ivoryOpacity = useTransform(pageProgress, [0, .26, .34], [1, 1, 0]);
  const peachOpacity = useTransform(pageProgress, [.24, .33, .4, .48], [0, 1, 1, 0]);
  const roseOpacity = useTransform(pageProgress, [.42, .5, .67, .75], [0, 1, 1, 0]);
  const duskOpacity = useTransform(pageProgress, [.69, .78, 1], [0, 1, 1]);
  const ivoryWillChange = useTransform(pageProgress, p => !reduced && p > .26 && p < .34 ? 'opacity' : 'auto');
  const peachWillChange = useTransform(pageProgress, p => !reduced && p > .24 && p < .48 ? 'opacity' : 'auto');
  const roseWillChange = useTransform(pageProgress, p => !reduced && p > .42 && p < .75 ? 'opacity' : 'auto');
  const duskWillChange = useTransform(pageProgress, p => !reduced && p > .69 && p < .79 ? 'opacity' : 'auto');
  const mergeMotion = celebrating ? { x: 0, y: 0, scale: 1.35, opacity: 1 } : undefined;
  const mergeTransition = { duration: .9, ease: entranceEase };
  return <div className="scene-background" aria-hidden="true"><canvas ref={canvasRef} />
    <motion.div className="color-grade grade-ivory" style={{ opacity: ivoryOpacity, willChange: ivoryWillChange }} />
    <motion.div className="color-grade grade-peach" style={{ opacity: peachOpacity, willChange: peachWillChange }} />
    <motion.div className="color-grade grade-rose" style={{ opacity: roseOpacity, willChange: roseWillChange }} />
    <motion.div className="color-grade grade-dusk" style={{ opacity: duskOpacity, willChange: duskWillChange }} />
    <div className="ambient-glows"><i className="ambient-glow glow-one"/><i className="ambient-glow glow-two"/><i className="ambient-glow glow-three"/></div>
    <div className="ambient-vignette" />
    <motion.div className="warm-grade" style={{ opacity: warmGradeOpacity, willChange: warmGradeWillChange }} />
    <motion.div className="light-bridge" style={{ scale: bridgeScale, opacity: bridgeOpacity, willChange: bridgeWillChange }} />
    <motion.div className="shared-orb shared-orb-a" animate={mergeMotion} transition={mergeTransition} style={{ x: orbAX, y: orbAY, opacity: orbOpacity, willChange: orbWillChange }} />
    <motion.div className="shared-orb shared-orb-b" animate={mergeMotion} transition={mergeTransition} style={{ x: orbBX, y: orbBY, opacity: orbOpacity, willChange: orbWillChange }} />
  </div>;
}

function MotionCharacter({ progress, text, index, at, reduced }) {
  const start = at + index * .00042;
  const opacity = useTransform(progress, p => easeOut((p - start) / .055));
  const y = useTransform(progress, p => 12 * (1 - easeOut((p - start) / .055)));
  const willChange = useTransform(progress, p => !reduced && p >= start && p <= start + .055 ? 'transform, opacity' : 'auto');
  return <motion.span aria-hidden="true" style={{ opacity: reduced ? 1 : opacity, ...(reduced ? {} : { y, willChange }) }}>{text === ' ' ? '\u00a0' : text}</motion.span>;
}

function renderWordCharacters(text, progress, at, reduced) {
  let characterIndex = 0;
  return text.match(/\S+|\s+/g).map((token, wordIndex) => {
    if (/^\s+$/.test(token)) {
      characterIndex += token.length;
      return <React.Fragment key={`space-${wordIndex}`}>{token}</React.Fragment>;
    }
    const startIndex = characterIndex;
    characterIndex += Array.from(token).length;
    return <span className="headline-word" aria-hidden="true" key={`word-${wordIndex}`}>{Array.from(token).map((character, index) => <MotionCharacter key={index} text={character} index={startIndex + index} progress={progress} at={at} reduced={reduced} />)}</span>;
  });
}

function ScrollPiece({ progress, at = 0, duration = .12, offset = 16, className = '', as = 'div', reduced = false, children, style = {}, exitStart = null }) {
  const Tag = motion[as] || motion.div;
  const end = Math.min(.45, at + duration);
  const isHeadline = /scene-title|opening-title|proposal-question|letter-title|hand-quote/.test(className);
  const isLetterReveal = /hand-quote|proposal-question/.test(className) && typeof children === 'string';
  const exitEnd = exitStart == null ? 1 : Math.min(.95, exitStart + .06);
  const opacity = useTransform(progress, p => Math.min(easeOut((p - at) / Math.max(.001, end - at)), exitStart == null || p <= exitStart ? 1 : 1 - Math.pow(clamp((p - exitStart) / Math.max(.001, exitEnd - exitStart)), 3)));
  const y = useTransform(progress, p => offset * (1 - easeOut((p - at) / Math.max(.001, end - at))));
  const maskY = useTransform(progress, p => (110 * (1 - easeOut((p - at) / Math.max(.001, end - at)))) + '%');
  const willChange = useTransform(progress, p => !reduced && (p >= at && p <= end || exitStart != null && p >= exitStart && p < 1) ? 'transform, opacity' : 'auto');
  const classes = 'scroll-piece' + (isHeadline ? ' masked-headline' : '') + (className ? ' ' + className : '');
  return <Tag className={classes} aria-label={isLetterReveal ? children : undefined} style={{ opacity, ...(reduced || isHeadline ? {} : { y }), willChange, ...style }}>
    {isHeadline ? <motion.span className="headline-mask-inner" style={reduced ? undefined : { y: maskY }}>{isLetterReveal ? renderWordCharacters(children, progress, at, reduced) : children}</motion.span> : children}
  </Tag>;
}

function Envelope({ progress, reduced }) {
  const rise = useTransform(progress, [.03, .22], [48, -52], { ease: entranceEase });
  const flap = useTransform(progress, [.08, .25], [0, 180], { ease: entranceEase });
  return <div className="envelope-art">
    <motion.div className="envelope-letter" style={{ y: reduced ? 0 : rise }} />
    <div className="envelope-body" />
    <motion.div className="envelope-flap" style={{ rotateX: reduced ? 180 : flap }} />
    <span className="envelope-front">For Saanvi</span>
  </div>;
}

function SceneTrack({ index, count, id, titleRef, reduced, children, proposal = false, mirror = false }) {
  const trackRef = useRef(null);
  const { scrollYProgress: progress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const entry = useTransform(progress, [0, .15], [0, 1], { ease: entranceEase });
  const isRecognition = id === 'somewhere-along-the-way';
  const exitRange = mirror ? [.85, .86, .885] : isRecognition ? [.86, .92, .98] : [.70, .79, .94];
  const exit = useTransform(progress, p => {
    if (p <= exitRange[0]) return 1;
    if (p >= exitRange[2]) return 0;
    if (p <= exitRange[1]) return 1 - .78 * exitEase((p - exitRange[0]) / (exitRange[1] - exitRange[0]));
    return .22 * (1 - exitEase((p - exitRange[1]) / (exitRange[2] - exitRange[1])));
  });
  const exitY = useTransform(progress, exitRange.slice(0, 2), [0, -20], { ease: exitEase });
  const entryWillChange = useTransform(progress, p => !reduced && index > 0 && p < .15 ? 'transform, opacity' : 'auto');
  const exitWillChange = useTransform(progress, p => !reduced && p > exitRange[0] && p < exitRange[2] ? 'transform, opacity' : 'auto');
  return <section ref={trackRef} id={id} className="scene-track" aria-label={id}>
    <div className="scene-stage" style={{ zIndex: index + 1 }}>
      <motion.div className="scene-entry" style={index === 0 ? undefined : { opacity: entry, willChange: entryWillChange }}>
        <motion.div className="scene-composition" style={proposal ? undefined : reduced ? { opacity: exit } : { opacity: exit, y: exitY, willChange: exitWillChange }}>
          {React.cloneElement(children, { progress, reduced, titleRef })}
        </motion.div>
      </motion.div>
    </div>
  </section>;
}

function Worlds({ progress, reduced }) {
  const hairlineScale = useTransform(progress, [.08, .32, .72, .9], [0, 1, 1, 0]);
  const hairlineOpacity = useTransform(progress, [.06, .14, .76, .92], [0, .48, .48, 0]);
  return <div className="composition worlds-composition">
    <svg className="distance-hairline" viewBox="0 0 1000 12" preserveAspectRatio="none" aria-hidden="true"><motion.path d="M4 6 C 245 4, 755 8, 996 6" style={{ scaleX: reduced ? 1 : hairlineScale, opacity: reduced ? 0 : hairlineOpacity }} /></svg>
    <ScrollPiece as="h2" className="scene-title" progress={progress} at={0} reduced={reduced}>Across the distance</ScrollPiece>
    <div className="composition-lines">
      {scenes.distance.map((line, i) => <ScrollPiece as="p" className="story-line" key={line} progress={progress} at={.09 + i * .085} reduced={reduced}>{line}</ScrollPiece>)}
    </div>
  </div>;
}

function Somewhere({ progress, reduced }) {
  const underline = useTransform(progress, [.35, .45], [0, 1]);
  return <div className="composition somewhere-composition">
    <ScrollPiece as="h2" className="scene-title recognition-title" progress={progress} at={0} reduced={reduced}>And then, you</ScrollPiece>
    <div className="recognition-lines">
      {scenes.recognition.map((line, i) => {
        const [beforeLose, afterLose] = line.split('lose');
        return <ScrollPiece as="p" className={`recognition-line${i === 3 ? ' recognition-line-final' : ''}`} key={line} progress={progress} at={.08 + i * .09} duration={.1} offset={12} reduced={reduced} exitStart={.72 + (3 - i) * .018}>
          {i === 3 ? <>{beforeLose}<span className="lose-word">lose<motion.svg className="lose-underline" viewBox="0 0 160 8" preserveAspectRatio="none" style={{ scaleX: reduced ? 1 : underline }} aria-hidden="true"><path d="M2 5.5 C 26 2.8, 47 6.7, 72 4.4 S 119 3.2, 158 4.8" /></motion.svg></span>{afterLose}</> : line}
        </ScrollPiece>;
      })}
    </div>
  </div>;
}

function Mirror({ progress, reduced }) {
  const mirrorScale = useTransform(progress, [.02, .2], [.94, 1], { ease: entranceEase });
  const frameDraw = useTransform(progress, [.025, .2], [1, 0], { ease: entranceEase });
  const frameOpacity = useTransform(progress, [.02, .045], [0, 1]);
  const glassOpacity = useTransform(progress, [.18, .31], [0, 1], { ease: entranceEase });
  const sweepX = useTransform(progress, [.27, .45], [-330, 330], { ease: entranceEase });
  const sweepOpacity = useTransform(progress, [.25, .28, .42, .47], [0, .68, .68, 0]);
  const reflectionFloat = useTransform(progress, [.24, .52, .8], [0, -5, 0], { ease: entranceEase });
  const reflectionFloatB = useTransform(progress, [.24, .52, .8], [0, 4, 0], { ease: entranceEase });
  return <div className="composition mirror-composition">
    <motion.div className="mirror-arch" style={{ opacity: reduced ? 1 : frameOpacity, scale: reduced ? 1 : mirrorScale }} aria-hidden="true">
      <svg viewBox="0 0 300 440" role="img" aria-label="A rose-gold arched mirror">
        <defs>
          <linearGradient id="mirror-frame-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c98a94"/><stop offset=".5" stopColor="#f2b8a0"/><stop offset="1" stopColor="#b46a78"/></linearGradient>
          <linearGradient id="mirror-glass-gradient" x1=".5" y1="0" x2=".5" y2="1"><stop offset="0" stopColor="#fbf3e8"/><stop offset="1" stopColor="#f2c9b8"/></linearGradient>
          <radialGradient id="mirror-upper-highlight" cx=".5" cy=".22" r=".68"><stop offset="0" stopColor="#fff8ed" stopOpacity=".82"/><stop offset="1" stopColor="#fff8ed" stopOpacity="0"/></radialGradient>
          <radialGradient id="mirror-reflection-a"><stop offset="0" stopColor="#fff8e7" stopOpacity=".88"/><stop offset=".13" stopColor="#f2b8a0" stopOpacity=".54"/><stop offset="1" stopColor="#f2b8a0" stopOpacity="0"/></radialGradient>
          <radialGradient id="mirror-reflection-b"><stop offset="0" stopColor="#fff3df" stopOpacity=".8"/><stop offset=".16" stopColor="#c98a94" stopOpacity=".48"/><stop offset="1" stopColor="#c98a94" stopOpacity="0"/></radialGradient>
          <linearGradient id="mirror-sweep-gradient" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff8ed" stopOpacity="0"/><stop offset=".48" stopColor="#fff8ed" stopOpacity=".46"/><stop offset=".68" stopColor="#f2b8a0" stopOpacity=".18"/><stop offset="1" stopColor="#fff8ed" stopOpacity="0"/></linearGradient>
          <radialGradient id="mirror-contact-shadow"><stop offset="0" stopColor="#5a2a3a" stopOpacity=".2"/><stop offset="1" stopColor="#5a2a3a" stopOpacity="0"/></radialGradient>
          <clipPath id="mirror-glass-clip"><path d="M40 416V151a110 110 0 0 1 220 0v265Z"/></clipPath>
        </defs>
        <ellipse cx="150" cy="428" rx="112" ry="10" fill="url(#mirror-contact-shadow)"/>
        <path className="mirror-glass" d="M40 416V151a110 110 0 0 1 220 0v265Z" fill="url(#mirror-glass-gradient)" style={{ opacity: reduced ? 1 : glassOpacity }}/>
        <g clipPath="url(#mirror-glass-clip)" className="mirror-glass-interior">
          <rect x="39" y="40" width="222" height="376" fill="url(#mirror-upper-highlight)"/>
          <motion.ellipse className="mirror-reflection mirror-reflection-a" cx="119" cy="242" rx="49" ry="58" fill="url(#mirror-reflection-a)" style={{ y: reduced ? 0 : reflectionFloat }}/>
          <motion.ellipse className="mirror-reflection mirror-reflection-b" cx="184" cy="235" rx="45" ry="54" fill="url(#mirror-reflection-b)" style={{ y: reduced ? 0 : reflectionFloatB }}/>
          <motion.g className="mirror-light-sweep" style={{ x: reduced ? 0 : sweepX, opacity: reduced ? 0 : sweepOpacity }}><path d="M94 15h50l120 430h-50Z" fill="url(#mirror-sweep-gradient)"/></motion.g>
        </g>
        <motion.path className="mirror-frame-outer" pathLength="1" d="M25 421V150a125 125 0 0 1 250 0v271Z" strokeDasharray="1" style={{ strokeDashoffset: reduced ? 0 : frameDraw, opacity: reduced ? 1 : frameOpacity }}/>
        <motion.path className="mirror-frame-inner" pathLength="1" d="M37 421V151a113 113 0 0 1 226 0v270Z" strokeDasharray="1" style={{ strokeDashoffset: reduced ? 0 : frameDraw, opacity: reduced ? 1 : frameOpacity }}/>
        <path className="mirror-crown-detail" d="M150 24l3.4 6.8 7.6 1.1-5.5 5.4 1.3 7.6-6.8-3.6-6.8 3.6 1.3-7.6-5.5-5.4 7.6-1.1Z"/>
      </svg>
    </motion.div>
    <div className="mirror-copy">
      <ScrollPiece as="p" className="hand-quote" progress={progress} at={.66} duration={.08} offset={12} reduced={reduced}>{scenes.mirror.primary}</ScrollPiece>
      {scenes.mirror.secondary && <ScrollPiece as="p" className="mirror-response" progress={progress} at={.82} duration={.07} offset={12} reduced={reduced}>{scenes.mirror.secondary}</ScrollPiece>}
    </div>
  </div>;
}

function Together({ progress, reduced }) {
  const pathOffset = useTransform(progress, [.04, .35], [320, 0]);
  const horizonY = useTransform(progress, [.04, .35], [45, 0]);
  const horizonOpacity = useTransform(progress, [.04, .3], [0, .62]);
  return <div className="composition together-composition">
    <motion.div className="horizon-glow" style={reduced ? undefined : { y: horizonY, opacity: horizonOpacity }} aria-hidden="true" />
    <svg className="together-path" viewBox="0 0 1000 150" preserveAspectRatio="none" aria-hidden="true"><motion.path d="M-20 126 C 180 8, 255 148, 455 78 S 760 18, 1020 112" style={{ strokeDashoffset: reduced ? 0 : pathOffset }} /></svg>
    <ScrollPiece as="h2" className="scene-title" progress={progress} at={0} reduced={reduced}>A little further, together</ScrollPiece>
    <div className="composition-lines">
      {scenes.together.map((line, i) => <ScrollPiece as="p" className="story-line" key={line} progress={progress} at={.065 + i * .073} reduced={reduced}>{line}</ScrollPiece>)}
    </div>
  </div>;
}

function Letter({ progress, reduced }) {
  const paperY = useTransform(progress, [.1, .35], [520, 0]);
  const paperOpacity = useTransform(progress, [.1, .25], [0, 1]);
  const headerOpacity = useTransform(progress, [.18, .34], [1, 0]);
  const envelopeOpacity = useTransform(progress, [.24, .38], [1, 0]);
  return <article className="letter-composition">
    <motion.div className="letter-heading" style={reduced ? { opacity: 0 } : { opacity: headerOpacity }}><ScrollPiece as="h2" className="letter-title" progress={progress} at={0} reduced={reduced}>A little letter</ScrollPiece><ScrollPiece as="p" className="letter-intro" progress={progress} at={.04} reduced={reduced}>Read whenever you’re ready.</ScrollPiece></motion.div>
    <motion.div className="letter-envelope" style={reduced ? { opacity: 0 } : { opacity: envelopeOpacity }}><Envelope progress={progress} reduced={reduced} /></motion.div>
    <motion.div className="letter-sheet-wrap" style={reduced ? { opacity: 1, y: 0 } : { y: paperY, opacity: paperOpacity }}>
      <div className="letter-contact-shadow" aria-hidden="true" />
      <div className="letter-paper">
        {letter.map((paragraph, i) => <ScrollPiece as="p" key={paragraph} className={i === 0 || i === letter.length - 1 ? 'letter-script' : ''} progress={progress} at={.11 + i * .034} duration={.08} offset={12} reduced={reduced}>{paragraph}</ScrollPiece>)}
      </div>
    </motion.div>
  </article>;
}

function Proposal({ accepted, onAccept, progress, reduced }) {
  const [attempts, setAttempts] = useState(0);
  const [dodge, setDodge] = useState({ x: 0, y: 0 });
  const noButtonRef = useRef(null);
  const proposalRef = useRef(null), magnetTargetRef = useRef(null);
  const dodgeRef = useRef({ x: 0, y: 0 });
  const lastDodgeRef = useRef(0);
  const noLabels = ['No', 'Really? Bold choice.', 'Cute. Try again.', "I'll wait, I'm very patient ♡", 'Come here, you idiot ♡'];
  const yesLabels = ['Yes, obviously ♡', 'Still here, still yours ♡', 'Right here, waiting ♡', "Just press me, I'm sweet ♡"];
  const finalNo = attempts >= 4;
  const yesScale = Math.min(1.3, 1 + attempts * .08);
  const noScale = Math.max(.7, 1 - attempts * .08);
  useEffect(() => {
    if (reduced || !matchMedia('(hover: hover) and (pointer: fine)').matches || finalNo) return;
    const move = event => {
      const button = noButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const distance = Math.hypot(event.clientX - cx, event.clientY - cy);
      if (distance < 90 && performance.now() - lastDodgeRef.current > 420) {
        lastDodgeRef.current = performance.now();
        const currentDodge = dodgeRef.current;
        const homeLeft = rect.left - currentDodge.x, homeTop = rect.top - currentDodge.y;
        const rightRoom = Math.max(0, innerWidth - homeLeft - rect.width - 24);
        const downRoom = Math.max(0, innerHeight - homeTop - rect.height - 24);
        const step = Math.floor(lastDodgeRef.current / 421) % 3;
        const x = Math.min(rightRoom, [112, 72, 132][step]);
        const y = Math.min(downRoom, [24, 48, 12][step]);
        const next = { x, y };
        dodgeRef.current = next;
        setDodge(next);
      } else if (distance > 190 && (dodgeRef.current.x || dodgeRef.current.y)) {
        const home = { x: 0, y: 0 };
        dodgeRef.current = home;
        setDodge(home);
      }
    };
    addEventListener('pointermove', move, { passive: true });
    return () => removeEventListener('pointermove', move);
  }, [reduced, finalNo]);
  useEffect(() => {
    const root = proposalRef.current;
    if (!root || reduced || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const move = event => {
      const button = event.target.closest?.('.response-buttons button');
      if (magnetTargetRef.current && magnetTargetRef.current !== button) magnetTargetRef.current.style.translate = '0px 0px';
      magnetTargetRef.current = button;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const dx = clamp((event.clientX - (rect.left + rect.width / 2)) * .08, -6, 6);
      const dy = clamp((event.clientY - (rect.top + rect.height / 2)) * .08, -6, 6);
      button.style.translate = `${dx}px ${dy}px`;
    };
    const leave = () => { if (magnetTargetRef.current) magnetTargetRef.current.style.translate = '0px 0px'; magnetTargetRef.current = null; };
    root.addEventListener('pointermove', move, { passive: true });
    root.addEventListener('pointerleave', leave, { passive: true });
    return () => { root.removeEventListener('pointermove', move); root.removeEventListener('pointerleave', leave); leave(); };
  }, [reduced, accepted]);
  const tryNo = () => {
    if (finalNo) onAccept();
    else { setAttempts(value => Math.min(4, value + 1)); const home = { x: 0, y: 0 }; dodgeRef.current = home; setDodge(home); }
  };
  const starOpacity = useTransform(progress, [.34, .4, .45, .51], [0, 1, .35, .85]);
  return <div ref={proposalRef} className="composition proposal-composition">
    {!accepted ? <>
      <div className="proposal-name-wrap"><ScrollPiece as="p" className="proposal-name" progress={progress} at={.05} reduced={reduced}>Saanvi,</ScrollPiece><motion.svg className="proposal-star" viewBox="0 0 20 20" style={{ opacity: reduced ? .65 : starOpacity }} aria-hidden="true"><path d="M10 1.5 12.2 7.8 18.5 10l-6.3 2.2L10 18.5l-2.2-6.3L1.5 10l6.3-2.2Z" /></motion.svg></div>
      <ScrollPiece as="h1" className="proposal-question" progress={progress} at={.16} reduced={reduced}>Will you be my girlfriend?</ScrollPiece>
      <ScrollPiece as="p" className="proposal-subtitle" progress={progress} at={.28} reduced={reduced}>Let's take this little adventure one step further. Together.</ScrollPiece>
      <ScrollPiece className="response-buttons" progress={progress} at={.38} duration={.07} reduced={reduced} style={{ gap: `${16 + 110 * (yesScale - 1)}px` }}>
        <motion.button type="button" className="response-yes" onClick={onAccept} aria-live="polite" aria-atomic="true" animate={{ scale: yesScale }} transition={{ type: 'spring', stiffness: 220, damping: 19 }} style={{ transformOrigin: 'center center' }}>{yesLabels[Math.min(Math.max(attempts - 1, 0), 3)]}</motion.button>
        <motion.button type="button" className="response-no" ref={noButtonRef} onClick={tryNo} aria-live="polite" aria-atomic="true" animate={{ x: finalNo ? 0 : dodge.x, y: finalNo ? 0 : dodge.y, scale: noScale }} transition={{ type: 'spring', stiffness: 210, damping: 20 }} style={{ transformOrigin: 'right center' }}>{noLabels[attempts]}</motion.button>
      </ScrollPiece>
    </> : <motion.div className="closing-copy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? .4 : .8 }}>
      <span className="celebration-ring" aria-hidden="true" />
      <div className="paper-confetti" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--i': i }} />)}</div>
      {scenes.ending.map((line, i) => <p className="ending-line celebration-enter" style={{ '--enter-delay': (i * 140) + 'ms' }} key={line}>{line}</p>)}<span className="closing-credit celebration-enter" style={{ '--enter-delay': '560ms' }}>made with care, for Saanvi</span>
    </motion.div>}
  </div>;
}

function Hero({ progress, reduced, titleRef }) {
  const hintOpacity = useTransform(progress, [0, .008], [.5, 0]);
  const titleOneY = useTransform(progress, [0, .70, .87], ['0%', '0%', '-110%']);
  const titleTwoY = useTransform(progress, [0, .72, .89], ['0%', '0%', '-110%']);
  const noteOpacity = useTransform(progress, [.72, .87], [1, 0]);
  return <div className="hero-composition">
    <span className="eyebrow">for Saanvi</span>
    <h1 className="opening-title" ref={titleRef}><span className="title-mask"><motion.span className="title-line" style={reduced ? undefined : { y: titleOneY }}>A Little Further,</motion.span></span><br/><span className="title-mask"><motion.em className="title-line" style={reduced ? undefined : { y: titleTwoY }}>Together</motion.em></span></h1>
    <motion.p className="opening-note" style={{ opacity: reduced ? 1 : noteOpacity }}>Something I wanted to ask you properly.</motion.p>
    <motion.div className="hero-scroll-hint" style={{ opacity: reduced ? .5 : hintOpacity }} aria-hidden="true"><span>scroll</span><small>sound on for the full experience</small><i /></motion.div>
  </div>;
}

function App() {
  const pageRef = useRef(null), heroTitleRef = useRef(null);
  const celebrationRef = useRef(false);
  const [accepted, setAccepted] = useState(false);
  const reduced = useReducedMotion();
  const sceneCount = 7, mirrorIndex = 3, proposalIndex = 6;
  const { scrollYProgress: pageProgress } = useScroll({ target: pageRef, offset: ['start start', 'end end'] });
  return <>
    <ContinuousBackground pageProgress={pageProgress} titleRef={heroTitleRef} sceneCount={sceneCount} mirrorIndex={mirrorIndex} proposalIndex={proposalIndex} celebrationRef={celebrationRef} celebrating={accepted} reduced={reduced} />
    <AudioExperience pageProgress={pageProgress} accepted={accepted} />
    <main ref={pageRef} className="scene-list">
      <SceneTrack index={0} count={sceneCount} id="beginning" reduced={reduced}><Hero titleRef={heroTitleRef} /></SceneTrack>
      <SceneTrack index={1} count={sceneCount} id="distance" reduced={reduced}><Worlds /></SceneTrack>
      <SceneTrack index={2} count={sceneCount} id="somewhere-along-the-way" reduced={reduced}><Somewhere /></SceneTrack>
      <SceneTrack index={3} count={sceneCount} id="the-mirror" reduced={reduced} mirror><Mirror /></SceneTrack>
      <SceneTrack index={4} count={sceneCount} id="together" reduced={reduced}><Together /></SceneTrack>
      <SceneTrack index={5} count={sceneCount} id="the-letter" reduced={reduced}><Letter /></SceneTrack>
      <SceneTrack index={6} count={sceneCount} id="proposal" reduced={reduced} proposal><Proposal accepted={accepted} onAccept={() => { celebrationRef.current = true; setAccepted(true); }} /></SceneTrack>
    </main>
  </>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);


