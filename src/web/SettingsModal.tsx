/**
 * 接口设置弹窗: antd Modal + Form, 保存后直接重连。
 * 结果用行内 Typography.Text 提示(不用 toast)。
 */
import { Form, Input, InputNumber, Modal, Typography } from "antd";
import { useEffect, useState } from "react";
import * as S from "./state";
import { fetchJSON } from "./state";
import { useStore } from "./useStore";

type Cfg = {
  base_url?: string;
  username?: string;
  password?: string;
  password_set?: boolean;
  provider?: string;
  refresh_ms?: number;
};

export default function SettingsModal() {
  const snap = useStore();
  const open = snap.configOpen;
  const [form] = Form.useForm<Cfg>();
  const [pwdHint, setPwdHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    form.resetFields();
    fetchJSON<Cfg>("/api/config")
      .then((c) => {
        form.setFieldsValue({
          base_url: c.base_url || "",
          username: c.username || "",
          password: "",
          provider: c.provider || "basic",
          refresh_ms: c.refresh_ms || 10000,
        });
        setPwdHint(c.password_set ? "已设置 ••••（留空则保持）" : "••••••••");
      })
      .catch(() => setPwdHint(""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    let values: Cfg;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setLoading(true);
    setMsg(null);
    const body: Record<string, unknown> = {
      base_url: values.base_url,
      username: values.username,
      provider: values.provider,
      refresh_ms: values.refresh_ms,
    };
    if (values.password) body.password = values.password;
    try {
      const j = await fetchJSON<Cfg>("/api/config", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setMsg({ ok: true, text: "✓ 已保存并连接" });
      S.setRefreshMs(j.refresh_ms || S.refreshMs);
      S.restartPoll();
      setTimeout(() => S.setConfigOpen(false), 600);
    } catch (e) {
      setMsg({ ok: false, text: "✗ " + String((e as Error).message ?? e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="接口设置"
      open={open}
      okText="保存并连接"
      cancelText="取消"
      confirmLoading={loading}
      onOk={save}
      onCancel={() => S.setConfigOpen(false)}
      destroyOnClose
      width={440}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          label="Hermes 地址"
          name="base_url"
          rules={[{ required: true, message: "请输入地址" }]}
        >
          <Input placeholder="http://192.18.18.200:9117" allowClear />
        </Form.Item>
        <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
          <Input placeholder="admin" autoComplete="off" />
        </Form.Item>
        <Form.Item label="密码" name="password" extra={pwdHint}>
          <Input.Password placeholder="••••••••" autoComplete="new-password" />
        </Form.Item>
        <Form.Item label="Provider" name="provider" rules={[{ required: true, message: "请输入 provider" }]}>
          <Input placeholder="basic" />
        </Form.Item>
        <Form.Item label="刷新间隔 (毫秒)" name="refresh_ms">
          <InputNumber min={3000} step={1000} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
      <div className="code-hint">
        若保存后报 Unknown provider，请改用 Hermes 实际启用的 provider（如 <code>local</code>）。
      </div>
      {msg ? (
        <Typography.Text type={msg.ok ? "success" : "danger"} style={{ display: "block", marginTop: 12 }}>
          {msg.text}
        </Typography.Text>
      ) : null}
    </Modal>
  );
}