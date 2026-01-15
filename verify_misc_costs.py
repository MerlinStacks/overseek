from playwright.sync_api import Page, expect, sync_playwright
import time
import re

def test_misc_costs(page: Page):
    print("Setting up mocks...")

    # Mock API responses

    # Product
    page.route(re.compile(r".*/api/products/123$"), lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='''{
            "id": "uuid-123",
            "wooId": 123,
            "name": "Test Product",
            "sku": "SKU-123",
            "price": "100.00",
            "salePrice": "",
            "stockStatus": "instock",
            "cogs": "50.00",
            "miscCosts": [{"amount": 5, "note": "Handling"}, {"amount": 2.50, "note": "Label"}],
            "type": "simple",
            "images": []
        }'''
    ))

    # Suppliers
    page.route(re.compile(r".*/api/inventory/suppliers"), lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='[]'
    ))

    # Auth
    page.route(re.compile(r".*/api/auth/me"), lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='{"id": "user1", "email": "test@example.com", "fullName": "Test User"}'
    ))

    # Accounts
    page.route(re.compile(r".*/api/accounts$"), lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='[{"id": "acc1", "name": "Test Account"}]'
    ))

    # Sales History (Fixed structure)
    page.route(re.compile(r".*/api/products/123/sales-history"), lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='{"sales": [], "total": 0, "page": 1, "limit": 15, "totalPages": 1}'
    ))

    # BOM
    page.route(re.compile(r".*/api/inventory/products/.*/bom"), lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='{"items": []}'
    ))

    # Audit Logs
    page.route(re.compile(r".*/api/audits/PRODUCT/123"), lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='[]'
    ))

    # Sync Status
    page.route(re.compile(r".*/api/sync/status"), lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='{"active": false}'
    ))

    # Notifications
    page.route(re.compile(r".*/api/notifications"), lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='[]'
    ))

    # Chat unread
    page.route(re.compile(r".*/api/chat/unread-count"), lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='{"count": 0}'
    ))

    print("Navigating to page...")
    # Inject auth token
    page.goto("http://localhost:5173/")
    page.evaluate("localStorage.setItem('token', 'mock_token')")

    # Force reload to pick up token if needed, or just nav
    page.goto("http://localhost:5173/inventory/product/123")

    print("Waiting for page load...")
    # Wait for title or something
    try:
        page.wait_for_selector("text=Pricing & Values", timeout=15000)
    except:
        print("Timeout waiting for Pricing tab. Taking screenshot.")
        page.screenshot(path="/home/jules/verification/timeout.png")
        raise

    print("Clicking Pricing tab...")
    page.get_by_text("Pricing & Values").click()

    print("Checking for Miscellaneous Costs...")
    # Wait for it to be visible
    expect(page.get_by_text("Miscellaneous Costs")).to_be_visible(timeout=5000)

    # Check values using locator instead of get_by_display_value
    expect(page.locator("input[value='Handling']")).to_be_visible()

    print("Taking verification screenshot...")
    page.screenshot(path="/home/jules/verification/verification.png")
    print("Done.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_misc_costs(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
