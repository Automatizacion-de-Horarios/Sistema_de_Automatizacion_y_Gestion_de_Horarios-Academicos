const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');

function pedirPasswordOculta() {
    return new Promise((resolve, reject) => {
        if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
            const rl = readline.createInterface({ input: stdin, output: stdout });
            rl.question('Contraseña (se mostrará mientras escribes): ').then((valor) => {
                rl.close();
                resolve(valor);
            }, reject);
            return;
        }

        let valor = '';
        stdout.write('Contraseña (no se mostrará mientras escribes): ');
        stdin.setRawMode(true);
        stdin.resume();
        const terminar = (resultado, error) => {
            stdin.off('data', alEscribir);
            stdin.setRawMode(false);
            stdin.pause();
            stdout.write('\n');
            if (error) reject(error);
            else resolve(resultado);
        };
        const alEscribir = (datos) => {
            for (const caracter of datos.toString()) {
                if (caracter === '\u0003') return terminar(null, new Error('Operación cancelada.'));
                if (caracter === '\r' || caracter === '\n') return terminar(valor);
                if (caracter === '\u007f' || caracter === '\b') valor = valor.slice(0, -1);
                else valor += caracter;
            }
        };
        stdin.on('data', alEscribir);
    });
}

async function main() {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const dni = (await rl.question('DNI: ')).trim();
    const correo = (await rl.question('Correo institucional: ')).trim();
    const nombres = (await rl.question('Nombres: ')).trim();
    const apellidos = (await rl.question('Apellidos: ')).trim();
    const rol = ((await rl.question('Rol (por ejemplo ADMIN o COORDINADOR): ')).trim() || 'COORDINADOR').toUpperCase();
    rl.close();

    if (!dni || !correo || !nombres || !apellidos) throw new Error('DNI, correo, nombres y apellidos son obligatorios.');
    const password = await pedirPasswordOculta();
    if (password.length < 8) throw new Error('Usa una contraseña de al menos 8 caracteres.');

    const passwordHash = await bcrypt.hash(password, 12);
    const [resultado] = await db.query(
        `INSERT INTO usuarios (dni, correo_institucional, password_hash, nombres, apellidos, rol, estado)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVO')`,
        [dni, correo, passwordHash, nombres, apellidos, rol]
    );
    console.log(`Cuenta creada con ID ${resultado.insertId}. La contraseña se guardó cifrada.`);
}

main()
    .catch((error) => {
        console.error(`No se pudo crear la cuenta: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(() => db.end());
