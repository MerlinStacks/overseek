import { AlertTriangle, Clock3, FileWarning, RefreshCw, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import type { InvoiceGenerationIssue } from '../../utils/invoiceGeneration';

interface InvoiceGenerationIssueModalProps {
    issue: InvoiceGenerationIssue | null;
    isRegenerating: boolean;
    cooldownSeconds: number;
    onClose: () => void;
    onRegenerate: () => void;
}

export function InvoiceGenerationIssueModal({
    issue,
    isRegenerating,
    cooldownSeconds,
    onClose,
    onRegenerate,
}: InvoiceGenerationIssueModalProps) {
    const isMissingTemplate = issue?.status === 'missing_template';
    const isRateLimited = issue?.statusCode === 429 || cooldownSeconds > 0;
    const canRegenerate = !!issue && !isMissingTemplate && !isRegenerating && cooldownSeconds <= 0;

    return (
        <Modal isOpen={!!issue} onClose={onClose} maxWidth="max-w-xl" title="Invoice recovery">
            {issue && (
                <div className="relative overflow-hidden rounded-3xl border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-1 shadow-xl dark:border-amber-500/30 dark:from-slate-900 dark:via-slate-900 dark:to-amber-950/40">
                    <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-amber-300/30 blur-3xl dark:bg-amber-500/20" />
                    <div className="absolute -bottom-20 -left-16 h-52 w-52 rounded-full bg-orange-300/20 blur-3xl dark:bg-orange-500/10" />
                    <div className="relative rounded-[1.35rem] bg-white/85 p-6 backdrop-blur dark:bg-slate-900/80">
                        <div className="flex items-start gap-4">
                            <div className="rounded-2xl bg-amber-100 p-3 text-amber-700 shadow-inner dark:bg-amber-500/15 dark:text-amber-300">
                                {isMissingTemplate ? <Settings size={28} /> : <FileWarning size={28} />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">Invoice needs attention</p>
                                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 dark:text-white">
                                    {isMissingTemplate ? 'Set up your invoice template first' : 'This invoice did not finish generating'}
                                </h2>
                                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                    {isMissingTemplate
                                        ? 'We need an invoice template before we can create a customer-ready PDF for this order.'
                                        : 'The order is safe, but the PDF renderer hit a conflict while preparing the invoice. You can ask Overseek to regenerate it now.'}
                                </p>
                            </div>
                        </div>

                        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/90 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                            <div className="flex gap-3 text-sm text-slate-700 dark:text-slate-200">
                                <AlertTriangle className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" size={18} />
                                <div>
                                    <p className="font-semibold">{issue.message}</p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        Order #{issue.orderId}{issue.invoiceRef ? ` · Reference ${issue.invoiceRef}` : ''}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {isRateLimited && (
                            <div className="mt-4 flex items-center gap-2 rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
                                <Clock3 size={16} />
                                <span>Please wait {cooldownSeconds || issue.retryAfterSeconds || 1}s before trying again.</span>
                            </div>
                        )}

                        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={onClose}
                                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                                Close
                            </button>
                            {isMissingTemplate ? (
                                <Link
                                    to="/invoices/design"
                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-slate-950/15 transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                                >
                                    <Settings size={16} />
                                    Open invoice designer
                                </Link>
                            ) : (
                                <button
                                    type="button"
                                    onClick={onRegenerate}
                                    disabled={!canRegenerate}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-amber-500/25 transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <RefreshCw className={isRegenerating ? 'animate-spin' : ''} size={16} />
                                    {isRegenerating ? 'Regenerating...' : cooldownSeconds > 0 ? `Try again in ${cooldownSeconds}s` : 'Regenerate invoice'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </Modal>
    );
}
