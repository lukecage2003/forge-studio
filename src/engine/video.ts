import { previewUrl, notifyMedia } from './media';
import type { Seg } from './speech';

/**
 * Preview playback of the face-cam rush across jump cuts.
 * Two <video> elements ping-pong: while one plays the current segment, the
 * other is already parked on the start of the next one, so cuts are instant.
 * Sound comes from Web Audio (sample-accurate), the videos stay muted.
 */
class ARollPlayer {
  private els: HTMLVideoElement[] = [];
  private active = 0;
  private seg = -1;
  private url = '';
  private seekTarget = -1;

  private ensure(mediaId: string) {
    // the light copy when there is one (engine/proxy): same picture, less decoding
    const url = previewUrl(mediaId);
    if (!url) return false;
    if (this.url !== url) {
      const at = this.els[this.active]?.currentTime ?? 0;
      this.els.forEach((e) => { e.pause(); e.removeAttribute('src'); e.load(); });
      this.els = [0, 1].map(() => {
        const e = document.createElement('video');
        e.muted = true;
        e.playsInline = true;
        e.preload = 'auto';
        e.src = url;
        if (at) e.currentTime = at;
        e.addEventListener('seeked', () => notifyMedia());
        e.addEventListener('loadeddata', () => notifyMedia());
        return e;
      });
      this.url = url;
      this.active = 0;
      this.seg = -1;
    }
    return true;
  }

  /** current frame source for drawing */
  frame(mediaId: string): HTMLVideoElement | null {
    if (!this.ensure(mediaId)) return null;
    const e = this.els[this.active];
    return e.readyState >= 2 ? e : null;
  }

  /** paused: show exactly this source time */
  seek(mediaId: string, src: number) {
    if (!this.ensure(mediaId)) return;
    const e = this.els[this.active];
    if (!e.paused) e.pause();
    if (Math.abs(e.currentTime - src) > 0.012 && Math.abs(this.seekTarget - src) > 0.001) {
      this.seekTarget = src;
      e.currentTime = src;
    }
  }

  start(mediaId: string, src: number, segIndex: number, segs: Seg[]) {
    if (!this.ensure(mediaId)) return;
    const e = this.els[this.active];
    e.currentTime = src;
    void e.play().catch(() => {});
    this.seg = segIndex;
    this.park(segs);
  }

  private park(segs: Seg[]) {
    const next = segs[this.seg + 1];
    const o = this.els[1 - this.active];
    if (next && o) {
      o.pause();
      o.currentTime = next.s;
    }
  }

  tick(src: number, segIndex: number, segs: Seg[]) {
    if (!this.els.length) return;
    if (segIndex !== this.seg) {
      const o = this.els[1 - this.active];
      if (segIndex === this.seg + 1 && Math.abs(o.currentTime - src) < 0.25) {
        this.els[this.active].pause();
        this.active = 1 - this.active;
        void this.els[this.active].play().catch(() => {});
      } else {
        const e = this.els[this.active];
        e.currentTime = src;
        void e.play().catch(() => {});
      }
      this.seg = segIndex;
      this.park(segs);
      return;
    }
    const e = this.els[this.active];
    if (Math.abs(e.currentTime - src) > 0.18) e.currentTime = src;
  }

  stop() {
    this.els.forEach((e) => e.pause());
    this.seg = -1;
  }
}

export const arollPlayer = new ARollPlayer();
