/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SYNC_URL?: string;
  readonly VITE_ALLOW_UNSIGNED_PACKS?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_GIT_SHA?: string;
  readonly VITE_BUILD_TIME?: string;
}
