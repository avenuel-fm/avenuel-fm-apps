import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {viteSingleFile} from 'vite-plugin-singlefile';

// 결과물을 HTML 파일 하나로 만들어 더블클릭으로도 열리게 함
export default defineConfig({plugins: [react(), viteSingleFile()], build: {chunkSizeWarningLimit: 4000}});
