// Web portals (CrazyGames, Poki) provide ads and want to know when gameplay starts and stops.
// This adapter picks the right SDK at runtime; on our own site (or in development) a stand-in
// "ad" is shown instead. Verify the SDK calls against each portal's current docs before launch:
// CrazyGames SDK v3 (window.CrazyGames.SDK) and Poki SDK (window.PokiSDK).

export interface Platform {
  readonly name: 'crazygames' | 'poki' | 'dev';
  /** Shows a rewarded ad. Resolves true only if the player watched it to the end. */
  rewardedAd(): Promise<boolean>;
  gameplayStart(): void;
  gameplayStop(): void;
  loadingFinished(): void;
}

interface CrazySDK {
  init(): Promise<void>;
  ad: { requestAd(type: 'rewarded', callbacks: { adFinished(): void; adError(e: unknown): void; adStarted?(): void }): void };
  game: { gameplayStart(): void; gameplayStop(): void; loadingStop(): void };
}
interface PokiSDK {
  init(): Promise<void>;
  rewardedBreak(): Promise<boolean>;
  gameplayStart(): void;
  gameplayStop(): void;
  gameLoadingFinished(): void;
}
declare global {
  interface Window { CrazyGames?: { SDK: CrazySDK }; PokiSDK?: PokiSDK }
}

class CrazyGamesPlatform implements Platform {
  readonly name = 'crazygames' as const;
  constructor(private sdk: CrazySDK) {}
  rewardedAd() {
    return new Promise<boolean>((resolve) => this.sdk.ad.requestAd('rewarded', { adFinished: () => resolve(true), adError: () => resolve(false) }));
  }
  gameplayStart() { this.sdk.game.gameplayStart(); }
  gameplayStop() { this.sdk.game.gameplayStop(); }
  loadingFinished() { this.sdk.game.loadingStop(); }
}

class PokiPlatform implements Platform {
  readonly name = 'poki' as const;
  constructor(private sdk: PokiSDK) {}
  rewardedAd() { return this.sdk.rewardedBreak().catch(() => false); }
  gameplayStart() { this.sdk.gameplayStart(); }
  gameplayStop() { this.sdk.gameplayStop(); }
  loadingFinished() { this.sdk.gameLoadingFinished(); }
}

/** Development / own site: a short stand-in so the whole reward flow can be tested. */
class DevPlatform implements Platform {
  readonly name = 'dev' as const;
  rewardedAd() {
    return new Promise<boolean>((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.85);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font:700 22px system-ui;gap:12px';
      let left = 3;
      const text = document.createElement('div');
      const skip = document.createElement('button');
      skip.textContent = 'Close (no reward)';
      skip.style.cssText = 'font:600 14px system-ui;padding:8px 14px;border-radius:8px;border:0';
      overlay.append('📺 Ad placeholder', text, skip);
      document.body.append(overlay);
      const tick = () => { text.textContent = `${left}…`; };
      tick();
      const timer = setInterval(() => {
        if (--left <= 0) { clearInterval(timer); overlay.remove(); resolve(true); } else tick();
      }, 1000);
      skip.onclick = () => { clearInterval(timer); overlay.remove(); resolve(false); };
    });
  }
  gameplayStart() {}
  gameplayStop() {}
  loadingFinished() {}
}

export async function detectPlatform(): Promise<Platform> {
  try {
    if (window.CrazyGames?.SDK) {
      await window.CrazyGames.SDK.init();
      return new CrazyGamesPlatform(window.CrazyGames.SDK);
    }
    if (window.PokiSDK) {
      await window.PokiSDK.init();
      return new PokiPlatform(window.PokiSDK);
    }
  } catch {
    // SDK failed to start (e.g. ad blocker): play without it.
  }
  return new DevPlatform();
}
