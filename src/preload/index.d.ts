import type { DictlyApi } from './index'

declare global {
  interface Window {
    api: DictlyApi
  }
}

export {}
