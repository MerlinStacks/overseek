(function () {
	function getNextShell(html, shellId) {
		var doc = new DOMParser().parseFromString(html, 'text/html');
		return shellId ? doc.getElementById(shellId) : doc.querySelector('[data-os-reviews-shell]');
	}

	function appendReviews(shell, nextShell) {
		var list = shell.querySelector('.os-reviews-list');
		var nextList = nextShell.querySelector('.os-reviews-list');
		if (!list || !nextList) {
			return false;
		}

		Array.prototype.forEach.call(nextList.children, function (card) {
			list.appendChild(card.cloneNode(true));
		});

		var pagination = shell.querySelector('.os-reviews-pagination');
		var nextPagination = nextShell.querySelector('.os-reviews-pagination');
		if (pagination && nextPagination) {
			pagination.replaceWith(nextPagination.cloneNode(true));
		} else if (pagination) {
			pagination.remove();
		}

		document.dispatchEvent(new CustomEvent('overseek:reviews:updated'));

		return true;
	}

	function setLoading(button, loading) {
		if (!button) {
			return;
		}

		button.toggleAttribute('aria-busy', loading);
		button.classList.toggle('is-loading', loading);
	}

	document.addEventListener('click', function (event) {
		var button = event.target.closest('.os-reviews-pagination--load_more .os-reviews-pagination__button, .os-reviews-pagination--infinite .os-reviews-pagination__button');
		if (!button) {
			return;
		}

		var shell = button.closest('[data-os-reviews-shell]');
		if (!shell) {
			return;
		}

		event.preventDefault();
		setLoading(button, true);

		fetch(button.href, { credentials: 'same-origin' })
			.then(function (response) {
				if (!response.ok) {
					throw new Error('Review page request failed');
				}
				return response.text();
			})
			.then(function (html) {
				var nextShell = getNextShell(html, shell.id);
				if (!nextShell || !appendReviews(shell, nextShell)) {
					window.location.href = button.href;
				}
			})
			.catch(function () {
				window.location.href = button.href;
			});
	});

	if ('IntersectionObserver' in window) {
		var observer = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				var button = entry.target.querySelector('.os-reviews-pagination__button');
				if (entry.isIntersecting && button && !button.hasAttribute('aria-busy')) {
					button.click();
				}
			});
		}, { rootMargin: '320px 0px' });

		function observeInfinitePagination() {
			document.querySelectorAll('.os-reviews-pagination--infinite').forEach(function (pagination) {
				observer.observe(pagination);
			});
		}

		document.addEventListener('DOMContentLoaded', observeInfinitePagination);
		document.addEventListener('overseek:reviews:updated', observeInfinitePagination);
		observeInfinitePagination();
	}
}());
