import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { siteConfig } from '../config/site';

export function DataDeletionPage() {
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
                    <div className="bg-red-600 px-8 py-10 text-white">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-white/20 rounded-lg">
                                <Trash2 className="w-8 h-8 text-white" />
                            </div>
                            <h1 className="text-3xl font-bold">Data Deletion Instructions</h1>
                        </div>
                        <p className="text-red-100 text-lg">
                            How to request deletion of your data
                        </p>
                    </div>

                    <div className="p-8 prose prose-red max-w-none">
                        <p className="lead text-gray-600">
                            At {siteConfig.appName}, we respect your right to control your personal data. This page explains how you can request the deletion of your data from our systems.
                        </p>

                        <h3>1. What Data We Store</h3>
                        <p>
                            When you use {siteConfig.appName} through Facebook Login, we may collect and store the following information:
                        </p>
                        <ul>
                            <li>Your Facebook User ID</li>
                            <li>Your email address (if provided)</li>
                            <li>Your name and profile information</li>
                            <li>Page and messaging data you authorize access to</li>
                        </ul>

                        <h3>2. How to Request Data Deletion</h3>
                        <p>
                            You can request deletion of your data in the following ways:
                        </p>

                        <div className="bg-gray-50 p-4 rounded-lg my-4">
                            <h4 className="font-semibold text-gray-900 mb-2">Option 1: Email Request</h4>
                            <p className="text-gray-700 mb-0">
                                Send an email to <a href={`mailto:${siteConfig.privacyEmail}`} className="text-red-600 hover:underline">{siteConfig.privacyEmail}</a> with the subject line "Data Deletion Request" and include:
                            </p>
                            <ul className="mt-2 text-gray-700">
                                <li>Your registered email address</li>
                                <li>Your Facebook User ID (if known)</li>
                                <li>A brief description of the data you want deleted</li>
                            </ul>
                        </div>

                        <div className="bg-gray-50 p-4 rounded-lg my-4">
                            <h4 className="font-semibold text-gray-900 mb-2">Option 2: Remove via Facebook</h4>
                            <p className="text-gray-700 mb-0">
                                You can remove {siteConfig.appName}'s access to your data directly from Facebook:
                            </p>
                            <ol className="mt-2 text-gray-700">
                                <li>Go to your Facebook Settings</li>
                                <li>Navigate to "Apps and Websites"</li>
                                <li>Find {siteConfig.appName} and click "Remove"</li>
                                <li>This will revoke our access to your Facebook data</li>
                            </ol>
                        </div>

                        <h3>3. What Happens After a Deletion Request</h3>
                        <p>
                            Upon receiving your deletion request, we will:
                        </p>
                        <ul>
                            <li>Verify your identity to protect against unauthorized requests</li>
                            <li>Process your request within 30 days</li>
                            <li>Delete all personal data associated with your account</li>
                            <li>Send you a confirmation once the deletion is complete</li>
                        </ul>

                        <h3>4. Data Retention</h3>
                        <p>
                            Please note that some data may be retained for legal compliance purposes, such as:
                        </p>
                        <ul>
                            <li>Transaction records (for accounting purposes)</li>
                            <li>Communication logs (for legal compliance)</li>
                            <li>Anonymized analytics data (which cannot identify you)</li>
                        </ul>

                        <h3>5. Contact Us</h3>
                        <p>
                            If you have any questions about data deletion or this policy, please contact us at <a href={`mailto:${siteConfig.privacyEmail}`}>{siteConfig.privacyEmail}</a>.
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
