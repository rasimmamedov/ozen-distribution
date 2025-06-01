import * as fs from 'fs/promises';

async function test() {
  try {
    await fs.writeFile('test.txt', 'Hello, world!');
    console.log('File written successfully');
  } catch (error) {
    console.error('Error:', error);
  }
}

app.listen(8080, () => {
  test();
  console.log('Сервер запущен на порту 8080');
  res.send('POST request to the homepage')
});

