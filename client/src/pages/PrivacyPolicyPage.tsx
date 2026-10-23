import { Link } from 'react-router-dom';
import { ArrowLeft, Shield } from 'lucide-react';
import { siteConfig } from '../config/site';
import { PrivacyContact } from '../components/common/PrivacyContact';

export function PrivacyPolicyPage() {
    const revision = siteConfig.privacyPolicyUpdatedAt;
    const hasRevision = /^\d{4}-\d{2}-\d{2}$/.test(revision) && Number.isFinite(Date.parse(revision)) && new Date(revision).toISOString().slice(0, 10) === revision;
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
                <div className="mb-8 flex items-center justify-between">
                    <Link to="/login" className="flex items-center text-gray-500 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white transition-colors">
                        <ArrowLeft size={20} className="mr-2" />
                        Back to Login
                    </Link>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <div className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-8 py-8 text-slate-900 dark:text-slate-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-[var(--brand-subtle)] text-[var(--brand-text)] rounded-lg">
                                <Shield className="w-8 h-8" />
                            </div>
                            <h1 className="text-3xl font-bold">Privacy Policy</h1>
                        </div>
                        {hasRevision && <p className="text-slate-500 dark:text-slate-400 text-sm">Last updated: <time dateTime={revision}>{revision}</time></p>}
                    </div>

                    <div className="p-8 prose prose-blue dark:prose-invert max-w-none">
                        <p className="lead text-gray-600 dark:text-slate-300">
                            At {siteConfig.appName}, we take your privacy seriously. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website or use our application.
                        </p>

                        <h2>1. Information We Collect</h2>
                        <p>
                            We collect information that you strictly provide to us when registering for an account, such as your name, email address, and business information. We also collect data related to your usage of our analytics services to provide you with accurate reports.
                        </p>

                        <h2>2. How We Use Your Information</h2>
                        <p>
                            We use the information we collect to:
                        </p>
                        <ul>
                            <li>Provide, operate, and maintain our services</li>
                            <li>Improve, personalize, and expand our services</li>
                            <li>Understand and analyze how you use our services</li>
                            <li>Communicate with you regarding updates and support</li>
                        </ul>

                        <h2>3. Data Security</h2>
                        <p>
                            We implement appropriate technical and organizational security measures designed to protect the security of any personal information we process. However, please also remember that we cannot guarantee that the internet itself is 100% secure.
                        </p>

                        <h2>4. Third-Party Services</h2>
                        <p>
                            We may share information with third-party vendors, service providers, contractors, or agents who perform services for us or on our behalf and require access to such information to do that work.
                        </p>

                        <h2>5. Contact Us</h2>
                        <p>
                            For questions or comments about this policy: <PrivacyContact />
                        </p>
                    </div>

                    <div className="px-8 py-6 bg-gray-50 dark:bg-slate-800 border-t border-gray-100 dark:border-slate-700 flex justify-center">
                        <p className="text-sm text-gray-500">
                            © {new Date().getFullYear()} {siteConfig.appName}. All rights reserved.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
