// Dr. Vibe - Resource Suggester
// Coordinates between learning detection, character animation, and UI display.
// Acts as the bridge between LearningDetector events and the ResourcePanel UI.

import { eventBus, Events } from '../../core/EventBus.js';

export class ResourceSuggester {
  constructor(character, learningDetector) {
    this.character = character;
    this.learningDetector = learningDetector;
    this.currentSuggestion = null;
  }

  init() {
    // When a learning resource is suggested, trigger character animation and show panel
    eventBus.on(Events.LEARNING_RESOURCE_SUGGESTED, (suggestion) => {
      this.currentSuggestion = suggestion;

      // Trigger library card animation on the character
      this.character.setState('libraryCard');

      // The ResourcePanel listens to the same event and displays the UI
    });

    // When user dismisses a suggestion
    eventBus.on(Events.LEARNING_RESOURCE_DISMISSED, ({ languageKey, projectName, dismissForProject }) => {
      if (dismissForProject && projectName) {
        this.learningDetector.dismissForProject(projectName, languageKey);
      }
      this.currentSuggestion = null;
    });

    console.log('ResourceSuggester initialized');
  }

  getCurrentSuggestion() {
    return this.currentSuggestion;
  }
}
