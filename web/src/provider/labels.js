export const STATUS_LABEL = { open: 'Open', booked: 'Booked', engaged: 'Engaged by agent', escalated: 'Escalated', callback: 'Callback', declined: 'Declined' };
export const riskClass = (r) => (r >= 70 ? 'h' : r >= 45 ? 'm' : 'l');
export const langLabel = (l) => (l === 'ar' ? 'Arabic' : 'English');
