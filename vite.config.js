import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // public/manifest.webmanifest을 그대로 사용하려면 아래 옵션 생략 가능
      // 여기서 직접 정의하고 싶다면 `manifest: { ... }`로 작성하세요.
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      workbox: {
        // 기본 캐싱 전략이면 비워도 됩니다.
      }
    })
  ]
})
