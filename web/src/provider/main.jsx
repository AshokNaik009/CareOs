import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/styles.css';
import ProviderApp from './ProviderApp.jsx';

createRoot(document.getElementById('root')).render(<StrictMode><ProviderApp /></StrictMode>);
