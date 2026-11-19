import {createRoot} from 'react-dom/client';
import {Theme} from '@astryxdesign/core/theme';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import './design/tokens.css';
import './design/palette.css';
import './design/parts.css';
import {theme} from './design/theme';
import FireCheckPage from './pages/FireCheckPage';

createRoot(document.getElementById('root')!).render(
  <Theme theme={theme} mode="light">
    <FireCheckPage />
  </Theme>,
);
