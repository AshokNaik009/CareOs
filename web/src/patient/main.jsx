import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/styles.css';
import PatientApp from './PatientApp.jsx';

createRoot(document.getElementById('root')).render(<StrictMode><PatientApp /></StrictMode>);
