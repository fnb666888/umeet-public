<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { client } from './api';
const api = client('umeet-admin-token'),
  schools = ref<any[]>([]),
  schoolId = ref(''),
  campusId = ref(''),
  title = ref(''),
  content = ref(''),
  busy = ref(false),
  message = ref(''),
  error = ref('');
const campuses = computed(() => schools.value.find((s) => s.id === schoolId.value)?.campuses || []);
onMounted(async () => {
  try {
    schools.value = await api('/schools');
  } catch (e: any) {
    error.value = e.message;
  }
});
async function publish() {
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await api('/admin/announcements', 'POST', {
      schoolId: schoolId.value,
      campusId: campusId.value,
      category: 'GUIDE',
      title: title.value,
      content: content.value,
    });
    title.value = '';
    content.value = '';
    message.value = '公告已发布到校园指南。';
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="panel">
    <h2>发布校园公告与指南</h2>
    <p class="muted">管理员发布后即时公开，请核实信息内容和适用学校。</p>
    <form class="stack" @submit.prevent="publish">
      <div class="form-row">
        <label
          >学校<select v-model="schoolId" required @change="campusId = ''">
            <option value="">选择学校</option>
            <option v-for="s in schools" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select></label
        ><label
          >校区<select v-model="campusId" required>
            <option value="">选择校区</option>
            <option v-for="c in campuses" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select></label
        >
      </div>
      <label
        >标题<input
          v-model="title"
          minlength="2"
          maxlength="60"
          placeholder="例如：新生报到指南"
          required /></label
      ><label
        >正文<textarea
          v-model="content"
          minlength="5"
          maxlength="2000"
          rows="8"
          placeholder="填写需要同学们了解的校园信息…"
          required
        ></textarea>
      </label>
      <div class="modal-actions">
        <button class="primary" :disabled="busy">{{ busy ? '发布中…' : '发布公告' }}</button>
      </div>
    </form>
    <div v-if="error" class="alert">{{ error }}</div>
    <div v-if="message" class="success">{{ message }}</div>
  </section>
</template>
