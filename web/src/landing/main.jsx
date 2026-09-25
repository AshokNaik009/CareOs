import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/styles.css';
import '../styles/landing.css';
import Landing from './Landing.jsx';

createRoot(document.getElementById('root')).render(<StrictMode><Landing /></StrictMode>);
