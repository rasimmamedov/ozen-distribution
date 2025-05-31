import express from 'express';
import puppeteer from 'puppeteer';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const cookiesPath = path.join('auth', 'cookies.json');
const tokensPath = path.join('auth', 'tokens.json');
const app = express();

// Основная функция для проверки ZVONKO digital
async function checkZvonkodigital() {
  let browser;
  try {

    // Путь к Chrome на MacOS (для вашей системы)
    // const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    // browser = await puppeteer.launch({
    //   executablePath: chromePath,
    //   headless: false, // Оставляем headless: false для отладки
    //   args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-features=SameSiteByDefaultCookies'],
    // });

    // Путь к Chrome на Linux (для вашей системы)
    const chromePath = '/usr/bin/google-chrome';
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true, // Оставляем headless: false для отладки
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Prevent crashes due to limited /dev/shm
        '--disable-accelerated-2d-canvas',
        '--disable-gpu', // Disable GPU in headless mode
        '--disable-features=SameSiteByDefaultCookies',
      ],  
    });

    const page = await browser.newPage();

    // Увеличиваем таймаут для навигации
    page.setDefaultNavigationTimeout(60000); // 60 секунд

    // Логируем события консоли страницы для отладки
    page.on('console', (msg) => console.log('Страница консоль:', msg.text()));

    // Загружаем куки, если они есть
    const cookiesLoaded = await loadCookies(page);

    // Пробуем перейти на страницу дашборда
    console.log('Переходим на страницу дашборда...');
    await page.goto('https://account.zvonkodigital.ru/dashboard', { waitUntil: 'domcontentloaded' });

    // Ждем завершения всех редиректов
    console.log('Ожидаем завершения редиректов...');
    await waitForNavigationToSettle(page);

    // Проверяем текущий URL после всех редиректов
    const currentUrl = page.url();
    console.log('Текущий URL после редиректов:', currentUrl);
    
    // Проверяем, авторизованы ли мы (только по URL)
    const isLoggedIn = currentUrl.includes('/dashboard') && cookiesLoaded;
    console.log('Статус авторизации (isLoggedIn):', isLoggedIn);
    if (!isLoggedIn || currentUrl.includes('account/oauth-login')) {
      console.log('Куки недействительны или отсутствуют, выполняем вход...');

      // Проверяем, находимся ли мы уже на странице логина
      if (!currentUrl.includes('auth.zvonkodigital.ru/login')) {
        // Если не на странице логина, переходим на страницу OAuth-логина
        console.log('Переходим на страницу OAuth-логина...');
        await page.goto('https://auth.zvonkodigital.ru/login', {
          waitUntil: 'domcontentloaded',
        });

        // Ждем завершения редиректов
        console.log('Ожидаем редирект на страницу логина...');
        await waitForNavigationToSettle(page);
      }

      // Проверяем текущий URL
      const loginUrl = page.url();
      console.log('Текущий URL:', loginUrl);

      if (!loginUrl.includes('auth.zvonkodigital.ru/login')) {
        throw new Error('Не удалось перейти на страницу логина');
      } else {
        console.log('Успешно перешли на страницу логина');
      }

      // Проверяем наличие CAPTCHA
      const captchaPresent = await page.evaluate(() => {
        return !!document.querySelector('input[name="captcha"]') || !!document.querySelector('.g-recaptcha');
      });
      if (captchaPresent) {
        throw new Error('Обнаружена CAPTCHA. Автоматический вход невозможен без решения CAPTCHA.');
      }

      // Ждем появления формы логина
      console.log('Ожидаем форму логина...');
      await page.waitForSelector('input[name="username"]', { timeout: 15000 });

      // Вводим логин и пароль
      console.log('Вводим учетные данные...');
      await page.type('#id_username', process.env.ZVONKO_USERNAME);
      await page.type('#id_password', process.env.ZVONKO_PASSWORD);

      // Нажимаем кнопку входа
      console.log('Нажимаем кнопку входа...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
        page.click('.submit-row input'), // Убедитесь, что селектор кнопки правильный
      ]);

      // Ждем редиректа на дашборд
      console.log('Ожидаем редирект на дашборд...');
      await page.waitForSelector('.css-16g8jyh', { timeout: 15000 });

      // Проверяем, что мы на дашборде
      const afterLoginUrl = page.url();
      console.log('URL после входа:', afterLoginUrl);
      if (!afterLoginUrl.includes('/dashboard')) {
        throw new Error('Не удалось войти: не перенаправлено на дашборд');
      }

      // Ждем установку куки
      console.log('Ожидаем установку куки...');
      await delay(2000); // Даем время на установку куки

      // Сохраняем куки
      await saveCookies(page);

      // Пробуем извлечь токены из localStorage
      const tokens = await page.evaluate(() => {
        return {
          localStorage: Object.fromEntries(Object.entries(localStorage)),
          sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
        };
      });
      console.log('Токены из localStorage и sessionStorage:', tokens);
      await fs.writeFile(tokensPath, JSON.stringify(tokens, null, 2));
      console.log('Токены сохранены в', tokensPath);

      console.log('Авторизация успешна, данные сохранены.');
    } else {
      console.log('Авторизация через куки успешна, вход не требуется.');
    }

    // Переходим на страницу с черновиками
    console.log('Переходим на страницу черновиков...');
    await page.goto('https://account.zvonkodigital.ru/music/drafts', { waitUntil: 'domcontentloaded' });

    // Ждем завершения всех редиректов
    console.log('Ожидаем завершения редиректов на странице черновиков...');
    await waitForNavigationToSettle(page);

    // Проверяем текущий URL
    const draftsUrl = page.url();
    console.log('Текущий URL после перехода на черновики:', draftsUrl);
    if (!draftsUrl.includes('/music/drafts')) {
      throw new Error('Не удалось перейти на страницу черновиков, возможно, сессия недействительна');
    }
    
    // Проверяем наличие записей
    try {
      // Wait for at least one element to appear
      await page.waitForFunction(
        () => document.querySelectorAll('.css-16g8jyh .css-177dxab .chakra-container.css-13qbca2 .chakra-stack.css-1w8h4cc .css-1xgpa60').length > 0,
        { timeout: 10000 }
      );
      const records = await page.$$('.css-16g8jyh .css-177dxab .chakra-container.css-13qbca2 .chakra-stack.css-1w8h4cc .css-1xgpa60');
      console.log(`Found ${records.length} elements`);
      for (const record of records) {
        const text = await page.evaluate(el => el.textContent.trim(), record);
        console.log('Element text:', text);
        console.log('Element:', record);
      }
    } catch (error) {
      console.error('Error:', error);
    }

   
    
    // Попробуем уточнить селектор
    // if (records.length > 0) {
    //   console.log(`Найдено ${records.length} записей!`);
    //   for (const record of records) {
    //     const recordData = await record.evaluate((el) => {
    //       // Извлекаем данные более структурировано
    //       const title = el.querySelector('div')?.textContent || '';
    //       const details = Array.from(el.querySelectorAll('div')).map((div) => div.textContent.trim());
    //       return { title, details };
    //     });

    //     // Фильтруем пустые записи
    //     if (recordData.title && recordData.details.some((detail) => detail.includes('UPC'))) {
    //       console.log('Запись:');
    //       console.log('  Название:', recordData.title);
    //       recordData.details.forEach((detail, index) => {
    //         if (detail && !detail.includes('Loading...')) {
    //           console.log(`  Деталь ${index + 1}: ${detail}`);
    //         }
    //       });
    //     }
    //   }
    // } else {
    //   console.log('Записей не найдено.');
    // }

  } catch (error) {
    console.error('Ошибка:', error.message);
  } finally {
    if (browser) {
      console.log('Закрываем браузер...');
      // await browser.close();
    }
  }
}

// Функция для загрузки куки
async function loadCookies(page) {
  try {
    // Проверяем, существует ли файл
    await fs.access(cookiesPath);
    const cookiesString = await fs.readFile(cookiesPath, 'utf-8');

    // Проверяем, не пустой ли файл
    if (!cookiesString.trim()) {
      console.log('Файл куки пуст.');
      return false;
    }

    // Парсим JSON
    const cookies = JSON.parse(cookiesString);
    if (!Array.isArray(cookies) || cookies.length === 0) {
      console.log('Куки не содержат данных.');
      return false;
    }

    await page.setCookie(...cookies);
    console.log('Куки загружены успешно.');
    return true;
  } catch (error) {
    console.log('Куки не найдены или ошибка загрузки:', error.message);
    return false;
  }
}

// Функция для сохранения куки
async function saveCookies(page) {
  const cookies = await page.cookies('https://account.zvonkodigital.ru', 'https://auth.zvonkodigital.ru');
  console.log('Куки для сохранения:', cookies);
  if (!cookies || cookies.length === 0) {
    console.warn('Предупреждение: Куки пусты, возможно, сессия не была установлена.');
  }
  await fs.writeFile(cookiesPath, JSON.stringify(cookies, null, 2));
  console.log('Куки сохранены в', cookiesPath);
}

// Функция для ожидания завершения редиректов
async function waitForNavigationToSettle(page) {
  let previousUrl = page.url();
  let sameUrlCount = 0;
  const maxChecks = 10; // Максимальное количество проверок
  const checkInterval = 1000; // Интервал проверки (1 секунда)

  for (let i = 0; i < maxChecks; i++) {
    await delay(checkInterval);
    const currentUrl = page.url();
    console.log(`Проверка редиректа ${i + 1}: Текущий URL - ${currentUrl}`);

    if (currentUrl === previousUrl) {
      sameUrlCount++;
      if (sameUrlCount >= 2) {
        console.log('Редиректы завершены, URL стабилен.');
        break;
      }
    } else {
      sameUrlCount = 0;
    }
    previousUrl = currentUrl;
  }
}

// Функция для задержки
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Запускаем проверку
checkZvonkodigital();

// Запускаем сервер
app.listen(8080, () => {
  console.log('Сервер запущен на порту 8080');
});