import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding Help Center...');

    // 1. Getting Started
    await prisma.helpCollection.upsert({
        where: { slug: 'getting-started' },
        update: {},
        create: {
            title: 'Getting Started',
            slug: 'getting-started',
            description: 'Everything you need to know to get up and running with Overseek.',
            icon: 'Box',
            order: 1,
            articles: {
                create: [
                    {
                        title: 'Welcome to Overseek',
                        slug: 'welcome-to-overseek',
                        content: `# Welcome to Overseek\n\nWelcome to your new command center for WooCommerce. Overseek helps you manage multiple stores, track analytics, and automate your workflow from a single dashboard.\n\n### Key Features\n\n- **Unified Dashboard**: See all your stores in one place.\n- **Real-time Sync**: Orders, products, and customers update instantly.\n- **Marketing Intel**: Track ad performance alongside sales.\n\n### Next Steps\n\n1. Connect your first WooCommerce store.\n2. Invite your team members.\n3. Configure your dashboard widgets.`,
                        excerpt: 'A quick introduction to Overseek and its key features.',
                        order: 1,
                        isPublished: true
                    },
                    {
                        title: 'Connecting Your Store',
                        slug: 'connecting-your-store',
                        content: `# Connecting WooCommerce\n\nTo connect your store, you'll need to generate API keys in WooCommerce.\n\n1. Go to **WooCommerce > Settings > Advanced > REST API**.\n2. Click **Add Key**.\n3. Set permissions to **Read/Write**.\n4. Copy the Consumer Key and Consumer Secret.\n5. Paste them into the Overseek "Connect Store" wizard.`,
                        excerpt: 'Step-by-step guide to connecting your WooCommerce store.',
                        order: 2,
                        isPublished: true
                    }
                ]
            }
        }
    });

    // 2. Analytics & Reporting
    await prisma.helpCollection.upsert({
        where: { slug: 'analytics' },
        update: {},
        create: {
            title: 'Analytics & Reporting',
            slug: 'analytics',
            description: 'Deep dive into your sales, revenue, and customer data.',
            icon: 'TrendingUp',
            order: 2,
            articles: {
                create: [
                    {
                        title: 'Understanding Your Dashboard',
                        slug: 'understanding-dashboard',
                        content: `# Dashboard Metrics\n\nYour main dashboard gives a health check of your business.\n\n- **Total Sales**: Gross revenue including tax and shipping.\n- **Net Sales**: Revenue minus returns and discounts.\n- **Orders**: Total number of orders placed.\n- **AOV (Average Order Value)**: Total Sales / Order Count.\n\n### Customizing Widgets\n\nYou can drag and drop widgets to rearrange your view. Click the "Edit Dashboard" button to add or remove specific metrics.`,
                        excerpt: 'Guide to the metrics and widgets available on your dashboard.',
                        order: 1,
                        isPublished: true
                    }
                ]
            }
        }
    });

    // 3. User Management
    await prisma.helpCollection.upsert({
        where: { slug: 'users' },
        update: {},
        create: {
            title: 'Team & Users',
            slug: 'users',
            description: 'Manage access, roles, and permissions for your team.',
            icon: 'Users',
            order: 3,
            articles: {
                create: [
                    {
                        title: 'Inviting Team Members',
                        slug: 'inviting-team',
                        content: `# Expanding Your Team\n\nYou can invite unlimited team members to your Overseek account.\n\n1. Navigate to **Settings > Team**.\n2. Click **Invite Member**.\n3. Enter their email and select a role.\n\n### Roles\n\n- **Admin**: Full access to all settings and stores.\n- **Manager**: Can manage stores but not billing or account ownership.\n- **Viewer**: Read-only access to dashboards.`,
                        excerpt: 'How to add users and assign roles.',
                        order: 1,
                        isPublished: true
                    }
                ]
            }
        }
    });

    console.log('Seeding completed.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
