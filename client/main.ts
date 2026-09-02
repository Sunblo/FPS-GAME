// Entry point: builds the stage + UI shells, wires the menu to the Game.
import { Menu } from './src/ui.ts';
import { Game } from './src/game.ts';

const stage = document.getElementById('stage')!;
const ui = document.getElementById('ui')!;

const menu = new Menu(ui);
const game = new Game(stage, ui);

menu.show();
menu.onStart = (a) => {
  menu.hide();
  game.onExit = () => menu.show();
  game.start(a);
};
