import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        // Update state so the next render will show the fallback UI.
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        // You can also log the error to an error reporting service
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    handleReload = () => {
        window.location.reload();
    };

    handleGoHome = () => {
        window.location.href = '/';
    };

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    height: '100vh',
                    width: '100vw',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#0f172a',
                    color: 'white',
                    padding: '20px'
                }}>
                    <div className="glass-panel" style={{
                        maxWidth: '500px',
                        padding: '40px',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '20px',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                    }}>
                        <div style={{
                            width: '64px',
                            height: '64px',
                            background: 'rgba(239, 68, 68, 0.2)',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#ef4444'
                        }}>
                            <AlertTriangle size={32} />
                        </div>

                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Something went wrong</h2>

                        <p style={{ color: '#94a3b8', lineHeight: '1.6' }}>
                            An unexpected error occurred in the application. We've logged this issue.
                            Please try reloading the page.
                        </p>

                        {this.state.error && (
                            <div style={{
                                background: 'rgba(0,0,0,0.3)',
                                padding: '15px',
                                borderRadius: '8px',
                                width: '100%',
                                textAlign: 'left',
                                fontSize: '0.85rem',
                                color: '#ef4444',
                                overflowX: 'auto',
                                fontFamily: 'monospace'
                            }}>
                                {this.state.error.toString()}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '15px', marginTop: '10px', width: '100%' }}>
                            <button
                                onClick={this.handleGoHome}
                                className="btn"
                                style={{ flex: 1, justifyContent: 'center', background: 'rgba(255,255,255,0.05)' }}
                            >
                                <Home size={18} style={{ marginRight: '8px' }} /> Go Home
                            </button>
                            <button
                                onClick={this.handleReload}
                                className="btn btn-primary"
                                style={{ flex: 1, justifyContent: 'center' }}
                            >
                                <RefreshCw size={18} style={{ marginRight: '8px' }} /> Reload Page
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
