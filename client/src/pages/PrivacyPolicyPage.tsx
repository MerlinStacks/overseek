import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield } from 'lucide-react';
import { siteConfig } from '../config/site';

export function PrivacyPolicyPage() {
    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
                <div className="mb-8 flex items-center justify-between">
                    <Link to="/login" className="flex items-center text-gray-500 hover:text-gray-900 transition-colors">
                        <ArrowLeft size={20} className="mr-2" />
                        Back to Login
                    </Link>
                </div>

                <div className="bg-white shadow-xl rounded-2xl overflow-hidden">
                    <div className="bg-blue-600 px-8 py-10 text-white">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-white/20 rounded-lg">
                                <Shield className="w-8 h-8 text-white" />
                            </div>
                            <h1 className="text-3xl font-bold">Privacy Policy</h1>
                        </div>
                        <p className="text-blue-100 text-lg">
                            Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                    </div>

                    <div className="p-8 prose prose-blue max-w-none">
                        <p className="lead text-gray-600">
                            At {siteConfig.appName}, we take your privacy seriously. This Privacy Policy explains how we collect, use, disclosure, and safeguard your information when you visit our website or use our application.
                        </p>

                        <h3>1. Information We Collect</h3>
                        <p>
                            We collect information that you strictly provide to us when registering for an account, such as your name, email address, and business information. We also collect data related to your usage of our analytics services to provide you with accurate reports.
                        </p>

                        <h3>2. How We Use Your Information</h3>
                        <p>
                            We use the information we collect to:
                        </p>
                        <ul>
                            <li>Provide, operate, and maintain our services</li>
                            <li>Improve, personalize, and expand our services</li>
                            <li>Understand and analyze how you use our services</li>
                            <li>Communicate with you regarding updates and support</li>
                        </ul>

                        <h3>3. Data Security</h3>
                        <p>
                            We implement appropriate technical and organizational security measures designed to protect the security of any personal information we process. However, please also remember that we cannot guarantee that the internet itself is 100% secure.
                        </p>

                        <h3>4. Third-Party Services</h3>
                        <p>
                            We may share information with third-party vendors, service providers, contractors, or agents who perform services for us or on our behalf and require access to such information to do that work.
                        </p>

                        <h3>5. Contact Us</h3>
                        <p>
                            If you have questions or comments about this policy, you may email us at <a href={`mailto:${siteConfig.supportEmail}`}>{siteConfig.supportEmail}</a>.
                        </p>
                    </div>

                    <div className="px-8 py-6 bg-gray-50 border-t border-gray-100 flex justify-center">
                        <p className="text-sm text-gray-500">
                            © {new Date().getFullYear()} {siteConfig.appName}. All rights reserved.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
