import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { siteConfig } from '../config/site';

export function TermsOfServicePage() {
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
                    <div className="bg-indigo-600 px-8 py-10 text-white">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-white/20 rounded-lg">
                                <FileText className="w-8 h-8 text-white" />
                            </div>
                            <h1 className="text-3xl font-bold">Terms of Service</h1>
                        </div>
                        <p className="text-indigo-100 text-lg">
                            Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                    </div>

                    <div className="p-8 prose prose-indigo max-w-none">
                        <p className="lead text-gray-600">
                            Welcome to {siteConfig.appName}. By accessing or using our services, you agree to be bound by these Terms of Service. Please read them carefully.
                        </p>

                        <h3>1. Acceptance of Terms</h3>
                        <p>
                            By accessing and using {siteConfig.appName} ("the Service"), you accept and agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree to these terms, you may not use the Service.
                        </p>

                        <h3>2. Description of Service</h3>
                        <p>
                            {siteConfig.appName} provides analytics, marketing automation, and business intelligence tools for e-commerce businesses. Our services include:
                        </p>
                        <ul>
                            <li>Website analytics and visitor tracking</li>
                            <li>E-commerce order and inventory management</li>
                            <li>Marketing campaign management</li>
                            <li>Customer relationship management</li>
                            <li>Social media messaging integration</li>
                            <li>Reporting and business insights</li>
                        </ul>

                        <h3>3. User Accounts</h3>
                        <p>
                            To use certain features of the Service, you must register for an account. You agree to:
                        </p>
                        <ul>
                            <li>Provide accurate and complete registration information</li>
                            <li>Maintain the security of your account credentials</li>
                            <li>Notify us immediately of any unauthorized access</li>
                            <li>Accept responsibility for all activities under your account</li>
                        </ul>

                        <h3>4. Acceptable Use</h3>
                        <p>
                            You agree not to use the Service to:
                        </p>
                        <ul>
                            <li>Violate any applicable laws or regulations</li>
                            <li>Infringe on the rights of others</li>
                            <li>Transmit harmful, offensive, or illegal content</li>
                            <li>Attempt to gain unauthorized access to our systems</li>
                            <li>Interfere with or disrupt the Service</li>
                            <li>Use the Service for fraudulent purposes</li>
                        </ul>

                        <h3>5. Third-Party Integrations</h3>
                        <p>
                            The Service may integrate with third-party platforms including Facebook, Instagram, Google, and WooCommerce. Your use of these integrations is subject to the respective third-party terms of service. We are not responsible for third-party services.
                        </p>

                        <h3>6. Intellectual Property</h3>
                        <p>
                            The Service and its original content, features, and functionality are owned by {siteConfig.appName} and are protected by international copyright, trademark, and other intellectual property laws.
                        </p>

                        <h3>7. Data and Privacy</h3>
                        <p>
                            Your use of the Service is also governed by our <Link to="/privacy-policy" className="text-indigo-600 hover:underline">Privacy Policy</Link>. By using the Service, you consent to our collection and use of data as described therein.
                        </p>

                        <h3>8. Limitation of Liability</h3>
                        <p>
                            To the maximum extent permitted by law, {siteConfig.appName} shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly.
                        </p>

                        <h3>9. Termination</h3>
                        <p>
                            We may terminate or suspend your account and access to the Service immediately, without prior notice, for conduct that we believe violates these Terms or is harmful to other users, us, or third parties, or for any other reason.
                        </p>

                        <h3>10. Changes to Terms</h3>
                        <p>
                            We reserve the right to modify these terms at any time. We will notify users of any material changes by posting the new Terms of Service on this page and updating the "Last updated" date.
                        </p>

                        <h3>11. Governing Law</h3>
                        <p>
                            These Terms shall be governed by and construed in accordance with the laws of Australia, without regard to its conflict of law provisions.
                        </p>

                        <h3>12. Contact Us</h3>
                        <p>
                            If you have any questions about these Terms, please contact us at <a href={`mailto:${siteConfig.legalEmail}`}>{siteConfig.legalEmail}</a>.
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
