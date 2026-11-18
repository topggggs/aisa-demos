/* Мини-приложение записи (тема aisa «app»).
 * Работает без сервера: запись в демо сохраняется только на этом устройстве (localStorage),
 * помощник отвечает по правилам (без внешних API и ключей). Данные — в #app-data. */
(function () {
  "use strict";

  var D = JSON.parse(document.getElementById("app-data").textContent);
  var STORE_KEY = "aisa-demo-bookings:" + location.pathname;
  var WEEK = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
    "сентября", "октября", "ноября", "декабря"];
  var STEP = 30;
  var DAYS_AHEAD = 14;

  // --- Утилиты -------------------------------------------------------------------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === "text") node.textContent = value;
      else if (key === "onclick") node.addEventListener("click", value);
      else if (key === "class") node.className = value;
      else node.setAttribute(key, value === true ? "" : value);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }
  function money(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function price(s) { return s.price_from_kzt ? "от " + money(s.price_from_kzt) + " ₸" : ""; }
  function join(parts) { return parts.filter(Boolean).join(" · "); }
  function hhmm(min) {
    var h = Math.floor(min / 60) % 24, m = min % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }
  function duration(min) {
    if (!min) return "";
    var h = Math.floor(min / 60), m = min % 60;
    return (h ? h + " ч" : "") + (h && m ? " " : "") + (m ? m + " мин" : "");
  }
  function startOfDay(date) { var d = new Date(date); d.setHours(0, 0, 0, 0); return d; }
  function addDays(date, n) { var d = startOfDay(date); d.setDate(d.getDate() + n); return d; }
  function dayKey(date) { return date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate(); }
  function sameDay(a, b) { return dayKey(a) === dayKey(b); }
  function dayLabel(date) {
    var today = startOfDay(new Date());
    if (sameDay(date, today)) return "сегодня";
    if (sameDay(date, addDays(today, 1))) return "завтра";
    return WEEK[date.getDay()].toLowerCase() + ", " + date.getDate() + " " + MONTHS[date.getMonth()];
  }
  function nowMinutes() { var n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
  function toast(text) {
    var box = document.getElementById("toast");
    box.textContent = text;
    box.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { box.hidden = true; }, 3200);
  }

  // --- Часы работы и свободное время -------------------------------------------
  function hoursFor(date) {
    if (!D.hoursKnown) return D.defaultHours;
    return D.hours[(date.getDay() + 6) % 7];
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch (e) { return []; }
  }
  function save(items) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch (e) { /* без хранилища */ }
  }
  function busyRanges(date) {
    return load().filter(function (b) { return b.day === dayKey(date); }).map(function (b) {
      return [b.time, b.time + Math.max(b.minutes, STEP)];
    });
  }
  function freeSlots(date, service) {
    var hours = hoursFor(date);
    if (!hours) return [];
    var length = service.minutes || 0;
    var busy = busyRanges(date);
    var earliest = sameDay(date, new Date()) ? nowMinutes() + 30 : 0;
    var slots = [];
    for (var t = hours[0]; t + length <= hours[1] && t < hours[1]; t += STEP) {
      if (t < earliest) continue;
      var end = t + Math.max(length, STEP);
      var taken = busy.some(function (r) { return t < r[1] && r[0] < end; });
      if (!taken) slots.push(t);
    }
    return slots;
  }

  // --- Статус «открыто» -----------------------------------------------------------
  (function openStatus() {
    var box = document.getElementById("open-status");
    if (!D.hoursKnown || !box) return;
    var today = hoursFor(new Date()), now = nowMinutes();
    var open = today && now >= today[0] && now < today[1];
    box.className = open ? "status-open" : "status-closed";
    box.textContent = open ? "Открыто до " + hhmm(today[1]) + " · " : "Сейчас закрыто · ";
  })();

  // --- Шторки -------------------------------------------------------------------
  var backdrop = document.getElementById("backdrop");
  function openSheet(sheet) {
    closeSheets();
    backdrop.hidden = false;
    sheet.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeSheets() {
    ["booking", "chat"].forEach(function (id) { document.getElementById(id).hidden = true; });
    backdrop.hidden = true;
    document.body.style.overflow = "";
  }
  backdrop.addEventListener("click", closeSheets);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheets(); });
  function sheetHeader(title) {
    return [
      el("div", { class: "grab" }),
      el("button", { class: "close", type: "button", "aria-label": "Закрыть", text: "✕", onclick: closeSheets }),
      el("h3", { text: title }),
    ];
  }

  // --- Запись -------------------------------------------------------------------
  var bookingSheet = document.getElementById("booking");
  var state = { service: null, date: null, time: null, name: "", phone: "" };

  function firstOpenDay(service) {
    for (var i = 0; i < DAYS_AHEAD; i++) {
      var d = addDays(new Date(), i);
      if (freeSlots(d, service).length) return d;
    }
    return null;
  }

  function openBooking(prefill) {
    state.service = prefill && prefill.service !== undefined ? prefill.service : state.service;
    state.date = prefill && prefill.date ? prefill.date : null;
    state.time = prefill && prefill.time !== undefined ? prefill.time : null;
    if (state.service !== null && !state.date) state.date = firstOpenDay(D.services[state.service]);
    renderBooking();
    openSheet(bookingSheet);
  }

  function renderBooking() {
    bookingSheet.replaceChildren.apply(bookingSheet, sheetHeader(D.action));
    var service = state.service === null ? null : D.services[state.service];

    bookingSheet.appendChild(el("div", { class: "step", text: "1. Услуга" }));
    var options = el("div", { class: "options" });
    D.services.forEach(function (s, index) {
      options.appendChild(el("button", {
        type: "button",
        class: "option" + (index === state.service ? " on" : ""),
        onclick: function () {
          state.service = index;
          state.time = null;
          if (!state.date || !freeSlots(state.date, s).length) state.date = firstOpenDay(s);
          renderBooking();
        },
      }, [el("span", {}, [el("b", { text: s.name }), s.minutes ? el("small", { text: " · " + duration(s.minutes) }) : null]),
        el("span", { text: price(s) })]));
    });
    bookingSheet.appendChild(options);
    if (!service) return;

    bookingSheet.appendChild(el("div", { class: "step", text: "2. День" }));
    var days = el("div", { class: "days" });
    for (var i = 0; i < DAYS_AHEAD; i++) {
      (function (d) {
        var hasSlots = freeSlots(d, service).length > 0;
        days.appendChild(el("button", {
          type: "button",
          class: "day" + (state.date && sameDay(d, state.date) ? " on" : ""),
          disabled: !hasSlots,
          onclick: function () { state.date = d; state.time = null; renderBooking(); },
        }, [el("small", { text: i === 0 ? "Сегодня" : WEEK[d.getDay()] }), el("b", { text: String(d.getDate()) }),
          el("small", { text: MONTHS[d.getMonth()].slice(0, 3) })]));
      })(addDays(new Date(), i));
    }
    bookingSheet.appendChild(days);
    if (!state.date) {
      bookingSheet.appendChild(el("p", { class: "empty", text: "В ближайшие две недели свободного времени нет." }));
      return;
    }

    bookingSheet.appendChild(el("div", { class: "step", text: "3. Время" + (service.minutes ? "" : " (к которому подготовить)") }));
    var slots = freeSlots(state.date, service);
    var times = el("div", { class: "times" });
    slots.forEach(function (t) {
      times.appendChild(el("button", {
        type: "button",
        class: "time" + (t === state.time ? " on" : ""),
        text: hhmm(t),
        onclick: function () { state.time = t; renderBooking(); focusName(); },
      }));
    });
    bookingSheet.appendChild(slots.length ? times : el("p", { class: "empty", text: "На этот день мест нет — выберите другой." }));
    if (!D.hoursKnown) {
      bookingSheet.appendChild(el("p", { class: "note", text: "Часы работы в демо примерные — в рабочей версии ваше расписание." }));
    }
    if (state.time === null) return;

    bookingSheet.appendChild(el("div", { class: "step", text: "4. Ваши данные" }));
    var name = el("input", { id: "b-name", autocomplete: "name", maxlength: "40", placeholder: "Как к вам обращаться", value: state.name });
    var phone = el("input", { id: "b-phone", type: "tel", autocomplete: "tel", maxlength: "20", placeholder: "+7 7__ ___ __ __", value: state.phone });
    var submit = el("button", { class: "btn primary big", type: "button", text: "Подтвердить запись" });
    function validate() {
      state.name = name.value.trim();
      state.phone = phone.value.trim();
      submit.disabled = state.name.length < 2 || state.phone.replace(/\D/g, "").length < 10;
    }
    name.addEventListener("input", validate);
    phone.addEventListener("input", validate);
    validate();
    submit.addEventListener("click", confirmBooking);
    bookingSheet.appendChild(el("label", { class: "field" }, [el("span", { text: "Имя" }), name]));
    bookingSheet.appendChild(el("label", { class: "field" }, [el("span", { text: "Телефон" }), phone]));
    bookingSheet.appendChild(el("div", { class: "summary" }, [
      el("b", { text: service.name }), el("br"),
      join([dayLabel(state.date) + ", " + hhmm(state.time), duration(service.minutes), price(service)]),
    ]));
    bookingSheet.appendChild(submit);
  }

  function focusName() {
    var input = document.getElementById("b-name");
    if (input && !input.value) setTimeout(function () { input.scrollIntoView({ block: "center" }); }, 50);
  }

  function confirmBooking() {
    var service = D.services[state.service];
    var booking = {
      service: service.name, minutes: service.minutes, day: dayKey(state.date),
      date: state.date.getTime(), time: state.time, name: state.name,
    };
    var items = load().filter(function (b) { return b.date + b.time * 60000 > Date.now() - 86400000; });
    items.push(booking);
    save(items);
    bookingSheet.replaceChildren.apply(bookingSheet, sheetHeader(""));
    bookingSheet.appendChild(el("div", { class: "done" }, [
      el("div", { class: "big-icon", text: "✓" }),
      el("h3", { text: "Готово, вы записаны!" }),
      el("div", { class: "summary" }, [
        el("b", { text: service.name }), el("br"),
        dayLabel(state.date) + " в " + hhmm(state.time) + " · " + D.name,
      ]),
      el("button", { class: "btn primary big", type: "button", text: "Отлично", onclick: closeSheets }),
      el("p", { class: "demo-note", text: "Это демо: запись сохранена только на этом телефоне и никуда не отправлена. В рабочей версии заявка сразу приходит владельцу, а время у мастера становится занятым." }),
    ]));
    renderMyBooking();
  }

  function renderMyBooking() {
    var box = document.getElementById("my-booking");
    var upcoming = load().filter(function (b) { return b.date + (b.time + Math.max(b.minutes, STEP)) * 60000 > Date.now(); })
      .sort(function (a, b) { return a.date + a.time * 60000 - (b.date + b.time * 60000); })[0];
    box.replaceChildren();
    if (!upcoming) return;
    box.appendChild(el("div", { class: "my-booking" }, [
      el("div", { class: "mb-icon", text: "📅" }),
      el("div", { class: "mb-text" }, [el("b", { text: "Вы записаны: " + upcoming.service }),
        dayLabel(new Date(upcoming.date)) + " в " + hhmm(upcoming.time)]),
      el("button", {
        class: "btn small", type: "button", text: "Отменить",
        onclick: function () {
          save(load().filter(function (b) { return !(b.day === upcoming.day && b.time === upcoming.time); }));
          renderMyBooking();
          toast("Запись отменена");
        },
      }),
    ]));
  }

  // --- Помощник (по правилам, без внешних сервисов) --------------------------------
  var chatSheet = document.getElementById("chat");
  var log = null;
  var STOP = { "для": 1, "или": 1, "без": 1, "под": 1, "все": 1, "шт": 1, "час": 1, "часа": 1, "сутки": 1, "минут": 1 };
  var WEEKDAYS = [["воскр", "вс"], ["понед", "пн"], ["вторн", "вт"], ["сред", "ср"], ["четв", "чт"], ["пятн", "пт"], ["суббот", "сб"]];

  function norm(text) { return text.toLowerCase().replace(/ё/g, "е"); }
  function stems(name) {
    return norm(name).split(/[^a-zа-я0-9]+/).filter(function (w) { return w.length >= 3 && !STOP[w]; })
      .map(function (w) { return w.length <= 4 ? w : w.slice(0, Math.min(6, Math.max(4, w.length - 2))); });
  }
  function matchService(text) {
    var best = null, bestScore = 0;
    D.services.forEach(function (s, index) {
      var score = stems(s.name).filter(function (st) { return text.indexOf(st) !== -1; }).length;
      if (score > bestScore) { best = index; bestScore = score; }
    });
    return best;
  }
  function matchDate(text) {
    var today = startOfDay(new Date());
    if (/послезавтра/.test(text)) return addDays(today, 2);
    if (/завтра/.test(text)) return addDays(today, 1);
    if (/сегодня/.test(text)) return today;
    if (/выходн/.test(text)) return addDays(today, (6 - today.getDay() + 7) % 7);
    if (/следующ\S* недел/.test(text)) return addDays(today, ((8 - today.getDay()) % 7) || 7);
    var dm = text.match(/(\d{1,2})[./](\d{1,2})/);
    if (dm) {
      var d = new Date(today.getFullYear(), Number(dm[2]) - 1, Number(dm[1]));
      if (d < today) d.setFullYear(d.getFullYear() + 1);
      return d;
    }
    for (var i = 0; i < 7; i++) {
      var w = WEEKDAYS[i];
      if (text.indexOf(w[0]) !== -1 || new RegExp("(^|\\s)(в|во|на)\\s+" + w[1] + "(\\s|$)").test(text)) {
        return addDays(today, ((i - today.getDay() + 7) % 7) || 7);
      }
    }
    return null;
  }
  function hour(h) { h = Number(h); return h <= 8 ? h + 12 : h; }
  function matchTime(text) {
    var m = text.match(/после\s+(\d{1,2})(?::(\d{2}))?/);
    if (m) return { after: hour(m[1]) * 60 + Number(m[2] || 0) };
    m = text.match(/до\s+(\d{1,2})(?::(\d{2}))?/);
    if (m) return { before: hour(m[1]) * 60 + Number(m[2] || 0) };
    m = text.match(/(\d{1,2}):(\d{2})/) || text.match(/(?:^|\s)(?:в|к)\s+(\d{1,2})(?:\s|$)/);
    if (m) return { at: hour(m[1]) * 60 + Number(m[2] || 0) };
    if (/утр/.test(text)) return { after: 0, before: 12 * 60 };
    if (/(дн[её]м|обед)/.test(text)) return { after: 12 * 60, before: 17 * 60 };
    if (/вечер/.test(text)) return { after: 17 * 60 };
    return null;
  }
  function fits(t, rule) {
    if (!rule) return true;
    if (rule.at !== undefined) return t >= rule.at;
    return (rule.after === undefined || t >= rule.after) && (rule.before === undefined || t < rule.before);
  }
  function findSlot(service, date, rule) {
    var start = date || startOfDay(new Date());
    var span = date ? 1 : DAYS_AHEAD;
    for (var i = 0; i < span; i++) {
      var d = addDays(start, i);
      var slot = freeSlots(d, service).filter(function (t) { return fits(t, rule); })[0];
      if (slot !== undefined) return { date: d, time: slot };
    }
    return null;
  }

  function say(text, who, extra) {
    var bubble = el("div", { class: "msg " + (who || "bot") }, [text]);
    (extra || []).forEach(function (node) { bubble.appendChild(node); });
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
  }
  function bookButton(prefill, label) {
    return el("button", { class: "btn primary small", type: "button", text: label || D.action, onclick: function () { openBooking(prefill); } });
  }
  function serviceChoices() {
    return D.services.slice(0, 6).map(function (s) {
      return el("button", { class: "btn small", type: "button", text: s.name, onclick: function () { reply(s.name); } });
    });
  }

  var memo = { date: null, time: null };  // «в субботу после 18» → потом выбор услуги

  function reply(text) {
    say(text, "me");
    var t = norm(text);
    var service = matchService(t);
    var date = matchDate(t);
    var time = matchTime(t);
    if (service === null && (date || time)) memo = { date: date, time: time };
    if (service !== null && !date && !time) { date = memo.date; time = memo.time; }
    if (service === null) {
      if (/(где|адрес|наход|добрат|маршрут|как проехать)/.test(t)) {
        return say(D.address ? "Мы находимся: " + D.address + (D.city ? ", " + D.city : "") + "." : "Адрес уточните по телефону — в демо он не указан.",
          "bot", D.links.map ? [el("a", { class: "btn small", href: D.links.map, rel: "noopener", text: "Открыть в 2ГИС" })] : []);
      }
      if (/(часы|график|работаете|открыт|закрыт|до скольки|во сколько)/.test(t)) {
        return say(D.hoursText ? "Мы работаем: " + D.hoursText + "." : "Часы работы уточните у нас — в демо они примерные.");
      }
      if (/(телефон|позвон|номер|связат|ватсап|whatsapp)/.test(t)) {
        return say("Свяжитесь с нами напрямую:", "bot", [
          D.links.whatsapp ? el("a", { class: "btn small", href: D.links.whatsapp, rel: "noopener", text: "WhatsApp" }) : null,
          D.links.phone ? el("a", { class: "btn small", href: D.links.phone, text: "Позвонить" }) : null,
        ].filter(Boolean));
      }
      if (/(цен|стоит|стоимост|прайс|сколько)/.test(t)) {
        return say(D.services.map(function (s) { return "• " + s.name + (price(s) ? " — " + price(s) : ""); }).join("\n") + "\n\nЦены в демо — пример.");
      }
      if (date || time) {
        return say("Подскажите, какая услуга нужна:", "bot", serviceChoices());
      }
      return say("Я подберу услугу и свободное время. Выберите услугу или напишите, например: «" + (D.example || D.services[0].name + " завтра") + "».", "bot", serviceChoices());
    }
    var s = D.services[service];
    var slot = findSlot(s, date, time);
    if (!slot && date) slot = findSlot(s, null, time);
    if (!slot) return say("На ближайшие две недели свободного времени на «" + s.name + "» нет. Напишите нам — постараемся найти окно.");
    var exact = !date || sameDay(slot.date, date);
    say((exact ? "Есть свободное время" : "На этот день мест нет, ближайшее") + ": «" + s.name + "» — " + dayLabel(slot.date) + " в " + hhmm(slot.time) +
      (s.minutes ? " (" + duration(s.minutes) + ")" : "") + (price(s) ? ", " + price(s) : "") + ". Записать вас?", "bot",
      [bookButton({ service: service, date: slot.date, time: slot.time }, "Да, записаться")]);
  }

  function openChat() {
    if (!log) {
      chatSheet.replaceChildren.apply(chatSheet, sheetHeader("Помощник"));
      log = el("div", { class: "chat-log", "aria-live": "polite" });
      var input = el("input", { maxlength: "200", placeholder: "Напишите, что нужно…", "aria-label": "Сообщение" });
      var form = el("form", { class: "chat-form" }, [input, el("button", { type: "submit", "aria-label": "Отправить", text: "➤" })]);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var text = input.value.trim();
        if (!text) return;
        input.value = "";
        reply(text.slice(0, 200));
      });
      var hints = [D.example, "Сколько стоит?", "Где вы находитесь?", "Во сколько работаете?"].filter(Boolean);
      var suggest = el("div", { class: "suggest" }, hints.map(function (h) {
        return el("button", { type: "button", text: h, onclick: function () { reply(h); } });
      }));
      chatSheet.appendChild(log);
      chatSheet.appendChild(suggest);
      chatSheet.appendChild(form);
      chatSheet.appendChild(el("p", { class: "note", text: "Демо-помощник: подбирает услугу и свободное время по вашему сообщению." }));
      say("Здравствуйте! Я помощник «" + D.name + "». Подберу услугу и свободное время." +
        (D.example ? " Например: «" + D.example + "»." : ""));
    }
    openSheet(chatSheet);
  }

  // --- Кнопки ---------------------------------------------------------------------
  document.querySelectorAll("[data-book]").forEach(function (button) {
    button.addEventListener("click", function () {
      var index = button.getAttribute("data-book");
      openBooking(index === "" ? { service: state.service } : { service: Number(index) });
    });
  });
  document.querySelectorAll("[data-chat]").forEach(function (button) {
    button.addEventListener("click", openChat);
  });
  renderMyBooking();

  // --- «На экран»: установка как приложение ----------------------------------------
  var installButton = document.getElementById("install-btn");
  var deferred = null;
  var standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    installButton.hidden = false;
  });
  if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) installButton.hidden = false;
  installButton.addEventListener("click", function () {
    if (deferred) {
      deferred.prompt();
      deferred = null;
      installButton.hidden = true;
    } else {
      toast("Нажмите «Поделиться» внизу экрана → «На экран Домой»");
    }
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () { /* без офлайна */ });
  }
})();
