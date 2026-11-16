Component({
  properties: { post: Object },
  methods: {
    open() {
      this.triggerEvent('open', { id: this.data.post.id });
    },
  },
});
