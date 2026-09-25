import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/styles.css';
import '../styles/live-health.css';
import LiveHealthApp from './LiveHealthApp.jsx';

createRoot(document.getElementById('root')).render(<StrictMode><LiveHealthApp /></StrictMode>);
