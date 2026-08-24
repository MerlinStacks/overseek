(function () {
	var reviewLightbox = null;
	var reviewLightboxContent = null;
	var reviewLightboxTrigger = null;

	function closeReviewLightbox() {
		if (!reviewLightbox || reviewLightbox.hidden) {
			return;
		}

		var video = reviewLightboxContent.querySelector('video');
		if (video) {
			video.pause();
		}
		reviewLightbox.hidden = true;
		reviewLightboxContent.replaceChildren();
		document.body.classList.remove('os-review-lightbox-open');
		if (reviewLightboxTrigger && document.contains(reviewLightboxTrigger)) {
			reviewLightboxTrigger.focus();
		}
		reviewLightboxTrigger = null;
	}

	function getReviewLightbox() {
		if (reviewLightbox) {
			return reviewLightbox;
		}

		reviewLightbox = document.createElement('div');
		reviewLightbox.className = 'os-review-lightbox';
		reviewLightbox.hidden = true;
		reviewLightbox.setAttribute('role', 'dialog');
		reviewLightbox.setAttribute('aria-modal', 'true');
		reviewLightbox.setAttribute('aria-label', 'Review media viewer');

		var dialog = document.createElement('div');
		dialog.className = 'os-review-lightbox__dialog';
		reviewLightboxContent = document.createElement('div');
		reviewLightboxContent.className = 'os-review-lightbox__content';

		var closeButton = document.createElement('button');
		closeButton.type = 'button';
		closeButton.className = 'os-review-lightbox__close';
		closeButton.setAttribute('aria-label', 'Close media viewer');
		var closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		closeIcon.setAttribute('viewBox', '0 0 24 24');
		closeIcon.setAttribute('aria-hidden', 'true');
		closeIcon.setAttribute('focusable', 'false');
		var closeIconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		closeIconPath.setAttribute('d', 'M6 6l12 12M18 6L6 18');
		closeIcon.appendChild(closeIconPath);
		closeButton.appendChild(closeIcon);
		closeButton.addEventListener('click', closeReviewLightbox);

		dialog.appendChild(reviewLightboxContent);
		dialog.appendChild(closeButton);
		reviewLightbox.appendChild(dialog);
		reviewLightbox.addEventListener('click', function (event) {
			if (event.target === reviewLightbox) {
				closeReviewLightbox();
			}
		});
		document.addEventListener('keydown', function (event) {
			if (!reviewLightbox || reviewLightbox.hidden) {
				return;
			}
			if (event.key === 'Escape') {
				closeReviewLightbox();
				return;
			}
			if (event.key === 'Tab') {
				var focusable = reviewLightbox.querySelectorAll('button:not([disabled]), video[controls]');
				if (!focusable.length) {
					event.preventDefault();
					return;
				}
				var first = focusable[0];
				var last = focusable[focusable.length - 1];
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault();
					last.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first.focus();
				}
			}
		});
		document.body.appendChild(reviewLightbox);

		return reviewLightbox;
	}

	function openReviewLightbox(trigger) {
		var url = trigger.dataset.osMediaUrl;
		if (!url) {
			return;
		}

		var lightbox = getReviewLightbox();
		var isVideo = trigger.dataset.osMediaType === 'video';
		var media = document.createElement(isVideo ? 'video' : 'img');
		media.src = url;
		if (isVideo) {
			media.controls = true;
			media.autoplay = true;
			media.playsInline = true;
		} else {
			media.alt = trigger.dataset.osMediaAlt || 'Customer review image';
		}

		var shell = trigger.closest('.os-reviews-shell');
		if (shell) {
			lightbox.style.setProperty('--os-review-accent-1', getComputedStyle(shell).getPropertyValue('--os-review-accent-1'));
		}
		reviewLightboxTrigger = trigger;
		reviewLightboxContent.replaceChildren(media);
		lightbox.hidden = false;
		document.body.classList.add('os-review-lightbox-open');
		lightbox.querySelector('.os-review-lightbox__close').focus();
		if (isVideo) {
			media.play().catch(function () {});
		}
	}

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

	function initReviewSubmitLocks() {
		document.querySelectorAll('.os-review-form').forEach(function (form) {
			if (form.dataset.osReviewSubmitLockReady) {
				return;
			}

			form.dataset.osReviewSubmitLockReady = '1';
			var nonceUrl = form.dataset.osReviewNonceUrl;
			var nonceInput = form.querySelector('input[name="overseek_review_nonce"]');
			if (nonceUrl && nonceInput) {
				form._osReviewNoncePromise = fetch(nonceUrl, { credentials: 'same-origin', cache: 'no-store' })
					.then(function (response) {
						if (!response.ok) {
							throw new Error('Unable to refresh review form nonce');
						}
						return response.json();
					})
					.then(function (payload) {
						if (payload && payload.success && payload.data && payload.data.nonce) {
							nonceInput.value = payload.data.nonce;
							form.dataset.osReviewNonceReady = '1';
							return true;
						}
						return false;
					})
					.catch(function () {
						return false;
					});
			}
			var fileInput = form.querySelector('input[type="file"][name="os_review_media[]"]');
			var fileLabel = form.querySelector('[data-os-review-file-label]');
			if (fileInput && fileLabel) {
				var defaultFileLabel = fileLabel.textContent;
				fileInput.addEventListener('change', function () {
					var count = fileInput.files ? fileInput.files.length : 0;
					var maxFiles = parseInt(fileInput.dataset.maxFiles || '6', 10);
					var maxBytes = parseInt(fileInput.dataset.maxBytes || '0', 10);
					var oversized = fileInput.files && Array.prototype.some.call(fileInput.files, function (file) {
						return maxBytes > 0 && file.size > maxBytes;
					});
					var validationMessage = count > maxFiles ? 'Please choose no more than ' + maxFiles + ' files.' : '';
					if (!validationMessage && oversized) {
						validationMessage = 'One or more files are too large.';
					}
					fileInput.setCustomValidity(validationMessage);
					fileLabel.textContent = count ? count + (count === 1 ? ' file selected' : ' files selected') : defaultFileLabel;
				});
			}
			form.addEventListener('submit', function (event) {
				var button = form.querySelector('.os-review-form__submit');
				if (form._osReviewNoncePromise && form.dataset.osReviewNonceReady !== '1') {
					event.preventDefault();
					if (form.dataset.osReviewNonceRefreshing === '1') {
						return;
					}

					form.dataset.osReviewNonceRefreshing = '1';
					if (button) {
						button.disabled = true;
					}
					form._osReviewNoncePromise.then(function (ready) {
						delete form.dataset.osReviewNonceRefreshing;
						if (!ready) {
							if (button) {
								button.disabled = false;
							}
							var notice = form.querySelector('[data-os-review-nonce-error]');
							if (!notice) {
								notice = document.createElement('div');
								notice.className = 'os-review-form__notice os-review-form__notice--error';
								notice.dataset.osReviewNonceError = '1';
								notice.setAttribute('role', 'alert');
								form.prepend(notice);
							}
							notice.textContent = 'The review form security check could not be refreshed. Please reload the page and try again.';
							return;
						}

						form.requestSubmit();
					});
					return;
				}
				if (form.dataset.osReviewSubmitting === '1') {
					event.preventDefault();
					return;
				}

				form.dataset.osReviewSubmitting = '1';
				if (button) {
					button.disabled = true;
					button.textContent = button.dataset.submittingLabel || 'Submitting...';
					setLoading(button, true);
				}
			});
		});
	}

	function isReviewRequestUrl() {
		var params = new URLSearchParams(window.location.search);
		return window.location.hash === '#review_form' || params.has('overseek_review_request') || params.has('overseek_review_rating');
	}

	function findWooTabLink(panelId) {
		var links = document.querySelectorAll('.woocommerce-tabs .tabs a, .tabs.wc-tabs a');
		for (var index = 0; index < links.length; index++) {
			if (links[index].hash === '#' + panelId || links[index].getAttribute('href') === '#' + panelId) {
				return links[index];
			}
		}

		return null;
	}

	function findReviewTabLink() {
		var links = document.querySelectorAll('.woocommerce-tabs .tabs a, .tabs.wc-tabs a');
		for (var index = 0; index < links.length; index++) {
			var href = links[index].getAttribute('href') || '';
			if (links[index].hash === '#tab-reviews' || href.indexOf('#tab-reviews') !== -1 || href.indexOf('#reviews') !== -1) {
				return links[index];
			}
		}

		return null;
	}

	function scrollToReviews() {
		var tabLink = findReviewTabLink();
		if (tabLink) {
			tabLink.click();
		}

		window.setTimeout(function () {
			var target = document.getElementById('reviews')
				|| document.getElementById('tab-reviews')
				|| document.querySelector('[data-os-product-reviews], .os-reviews-shell--product');
			if (!target) {
				return;
			}
			var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
		}, 80);
	}

	function isSamePageReviewsLink(link) {
		if (!link || link.hash !== '#reviews') {
			return false;
		}
		return link.origin === window.location.origin && link.pathname.replace(/\/$/, '') === window.location.pathname.replace(/\/$/, '');
	}

	function revealReviewFormFromUrl(attempt) {
		if (!isReviewRequestUrl()) {
			return;
		}

		attempt = attempt || 0;

		var form = document.querySelector('.os-review-form') || document.getElementById('review_form');
		if (!form) {
			var reviewTabLink = findReviewTabLink();
			if (reviewTabLink) {
				reviewTabLink.click();
			}

			if (attempt < 12) {
				window.setTimeout(function () {
					revealReviewFormFromUrl(attempt + 1);
				}, 250);
			}

			return;
		}

		var panel = form.closest('.woocommerce-Tabs-panel, .woocommerce-tabs .panel');
		if (panel && panel.id) {
			var tabLink = findWooTabLink(panel.id);
			if (tabLink) {
				tabLink.click();
			}
		}

		window.setTimeout(function () {
			form.scrollIntoView({ behavior: 'smooth', block: 'start' });
			form.classList.add('os-review-form--focused');
			if (window.location.hash !== '#review_form') {
				history.replaceState(null, '', window.location.pathname + window.location.search + '#review_form');
			}
		}, 120);
	}

	document.addEventListener('click', function (event) {
		var reviewsLink = event.target.closest('.os-review-stars-summary__link[href*="#reviews"]');
		if (isSamePageReviewsLink(reviewsLink)) {
			event.preventDefault();
			history.replaceState(null, '', '#reviews');
			scrollToReviews();
			return;
		}

		var mediaButton = event.target.closest('[data-os-review-media]');
		if (mediaButton) {
			event.preventDefault();
			openReviewLightbox(mediaButton);
			return;
		}

		var sliderButton = event.target.closest('[data-os-review-slider-prev], [data-os-review-slider-next]');
		if (sliderButton) {
			var sliderShell = sliderButton.closest('[data-os-review-slider]');
			var sliderList = sliderShell ? sliderShell.querySelector('.os-reviews-list--slider') : null;
			if (sliderList) {
				event.preventDefault();
				var direction = sliderButton.hasAttribute('data-os-review-slider-prev') ? -1 : 1;
				sliderList.scrollBy({ left: direction * Math.max(280, sliderList.clientWidth * 0.8), behavior: 'smooth' });
			}
			return;
		}

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

	function initReviewSliders() {
		document.querySelectorAll('[data-os-review-slider][data-os-review-autoplay="1"]').forEach(function (shell) {
			if (shell.dataset.osReviewAutoplayReady) {
				return;
			}
			shell.dataset.osReviewAutoplayReady = '1';
			var list = shell.querySelector('.os-reviews-list--slider');
			if (!list) {
				return;
			}
			window.setInterval(function () {
				if (document.hidden || shell.matches(':hover')) {
					return;
				}
				var nextLeft = list.scrollLeft + Math.max(280, list.clientWidth * 0.8);
				if (nextLeft >= list.scrollWidth - list.clientWidth - 8) {
					nextLeft = 0;
				}
				list.scrollTo({ left: nextLeft, behavior: 'smooth' });
			}, 4500);
		});
	}

	document.addEventListener('DOMContentLoaded', initReviewSliders);
	document.addEventListener('overseek:reviews:updated', initReviewSliders);
	initReviewSliders();

	document.addEventListener('DOMContentLoaded', initReviewSubmitLocks);
	document.addEventListener('overseek:reviews:updated', initReviewSubmitLocks);
	initReviewSubmitLocks();

	document.addEventListener('DOMContentLoaded', revealReviewFormFromUrl);
	revealReviewFormFromUrl();

}());
